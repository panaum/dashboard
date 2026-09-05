import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Every route under /api must carry a credential of its own.
//
// WHY THIS EXISTS: src/proxy.ts matches "/dashboard/:path*" and nothing else, so
// no route under /api has ever been covered by the middleware — and even for the
// paths it does match, it only checks that the cookie EXISTS, not that it is
// signed. Four internal proxy routes were therefore reachable unauthenticated in
// production (registry client/site pickers, the presence dots, and — worst — a
// POST that relays to LinkSpy's rate-limited battery using our service key).
//
// A route may authenticate in exactly one of three ways. This test pins which,
// so adding a new route forces an explicit decision rather than inheriting a
// protection that was never there.
// ─────────────────────────────────────────────────────────────────────────────

// Team session, verified by signature in the handler (requireApiAuth → 401 JSON).
const SESSION_GUARDED = [
  "src/app/api/registry/clients/route.ts",
  "src/app/api/registry/clients/[clientId]/sites/route.ts",
  "src/app/api/registry/prefills/refresh/route.ts",
  "src/app/api/presence/clients/route.ts",
  "src/app/api/linkspy/check/route.ts",
  "src/app/api/linkspy/monitor/route.ts",
  "src/app/api/linkspy/shot/route.ts",
  "src/app/api/layout-shot/route.ts",
];

// Service-to-service: a shared secret compared timing-safely, or an HMAC envelope.
const SERVICE_GUARDED: Record<string, RegExp> = {
  "src/app/api/registry-bridge/delivery/route.ts": /DASHBOARD_BRIDGE_KEY/,
  "src/app/api/spine/inbox/route.ts": /SPINE_SECRET/,
  "src/app/api/spine/drain/route.ts": /CRON_SECRET/,
  "src/app/api/spine/outbox-status/route.ts": /SPINE_SECRET/,
};

// Deliberately unauthenticated. Each needs a stated reason.
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // The share token IS the credential; the route 404s for an unknown/absent one.
  "src/app/api/living-certificate/[shareId]/route.ts": "public share-token route",
  // Documented in INFRASTRUCTURE.md as no-auth; emits only emit-flag + counts.
  "src/app/api/spine/health/route.ts": "operational health probe",
};

function allRoutes(dir = "src/app/api"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...allRoutes(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

test("every /api route is classified — a new one must declare its auth", () => {
  const known = new Set([
    ...SESSION_GUARDED,
    ...Object.keys(SERVICE_GUARDED),
    ...Object.keys(PUBLIC_BY_DESIGN),
  ]);
  for (const r of allRoutes()) {
    assert.ok(
      known.has(r),
      `${r} is unclassified. Add it to SESSION_GUARDED, SERVICE_GUARDED, or ` +
        `PUBLIC_BY_DESIGN — an unlisted route is an unguarded route.`,
    );
  }
});

// Comments legitimately name the very things the ordering check looks for (the
// handlers explain that LINKSPY_API_KEY stays server-side), so strip them first
// — otherwise prose position, not code position, decides the assertion.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("internal proxy routes verify the team session in the handler", () => {
  for (const f of SESSION_GUARDED) {
    const src = read(f);
    assert.match(src, /requireApiAuth/, `${f} must call requireApiAuth()`);
    // The guard has to run before any work — in particular before the handler
    // reaches for LINKSPY_API_KEY or hits the database.
    const code = stripComments(src);
    const guardAt = code.indexOf("requireApiAuth()");
    assert.ok(guardAt >= 0, `${f} must CALL requireApiAuth(), not merely import it`);
    for (const leak of ["LINKSPY_API_KEY", "process.env.LINKSPY", "db."]) {
      const useAt = code.indexOf(leak);
      if (useAt === -1) continue;
      assert.ok(guardAt < useAt, `${f} must call requireApiAuth() before touching ${leak}`);
    }
  }
});

test("requireApiAuth answers 401 rather than redirecting", () => {
  const src = read("src/lib/auth.ts");
  assert.match(src, /export async function requireApiAuth/);
  // A redirect to an HTML login page is the wrong answer to a fetch().
  const body = src.slice(src.indexOf("export async function requireApiAuth"));
  assert.match(body, /status:\s*401/, "must return a 401");
  assert.doesNotMatch(body, /redirect\(/, "must not redirect an API caller");
});

test("service-authed bridges compare a shared secret, not a session", () => {
  for (const [f, secret] of Object.entries(SERVICE_GUARDED)) {
    const src = read(f);
    assert.match(src, secret, `${f} must read ${secret.source}`);
    assert.doesNotMatch(src, /requireApiAuth/, `${f} is called by a server, not a browser`);
  }
});

test("the proxy matcher still does not claim to cover /api", () => {
  // If this ever changes, the comments in these handlers (and this test's
  // premise) need revisiting — middleware presence-checks are not a substitute
  // for signature verification, so widening the matcher must not remove guards.
  const src = read("src/proxy.ts");
  assert.match(src, /matcher:\s*\["\/dashboard\/:path\*"\]/);
});
