import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { livingCertificateFlagOn } from "./flag";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Source with comments removed.
 *
 * These bans are on what the code DOES, not on what it talks about — the route
 * documents the getPageStatus/LinkSpyStatus prohibition in prose, and that
 * explanation is the most valuable line in the file. Asserting against raw text
 * would force the ban and its rationale to be mutually exclusive.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const ROUTE = "src/app/api/living-certificate/[shareId]/route.ts";
const LIB = "src/lib/living-certificate";

function filesUnder(dir: string): string[] {
  const abs = resolve(process.cwd(), dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(dir, entry)));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(join(dir, entry));
  }
  return out;
}

// ═══ INVARIANT 3 — READ-ONLY ═══
// The composing endpoint is reachable by anyone holding a share link. If it can
// write, an anonymous visitor can make our database do work on request.
test("the living-certificate path never writes", () => {
  const WRITE = /\bdb\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
  for (const f of [ROUTE, ...filesUnder(LIB)]) {
    assert.doesNotMatch(code(f), WRITE, `${f} must not write to the database`);
  }
});

// getPageStatus() upserts LinkSpyStatus (src/lib/linkspy/client.ts:62). It is
// the obvious helper to reach for and the one that would silently break
// Invariant 3, so the ban is explicit rather than implied by the regex above.
test("the endpoint does not reuse the writing status helper", () => {
  const src = code(ROUTE);
  assert.doesNotMatch(src, /getPageStatus/, "must use the read-only sibling, not getPageStatus");
  // Reading `linkspyStatus.fetchedAt` through the Page relation is a READ and is
  // how Section 3 gets its freshness. What is banned is the model accessor,
  // which is the surface every write goes through.
  assert.doesNotMatch(src, /db\.linkSpyStatus/, "must not access the LinkSpyStatus model directly");
});

// LinkSpyStatus.payload is LinkSpy's raw internal status. Section 3 needs the
// timestamp beside it and nothing else; selecting the payload would put internal
// state one JSON.stringify away from a client's browser.
test("the raw LinkSpy payload is never selected", () => {
  assert.doesNotMatch(code(ROUTE), /payload/, "the route must never read LinkSpyStatus.payload");
});

// ═══ F5 — the signed handoff links are internal ═══
// getClientPresenceChips() returns hrefByChip: HMAC-signed deep links into
// internal LinkSpy. They must never be serialised to a client's browser.
test("no internal handoff link can reach the client payload", () => {
  for (const f of [ROUTE, ...filesUnder(LIB)]) {
    const src = code(f);
    assert.doesNotMatch(src, /hrefByChip/, `${f} must not carry internal handoff links`);
    assert.doesNotMatch(src, /signHandoff/, `${f} must not sign handoff tokens`);
  }
});

// ═══ INVARIANT 4 — one capability ═══
// The boolean selects a rendering; it must never grant access on its own, and no
// second token may be minted here.
test("the endpoint mints no token and adds no auth mechanism", () => {
  const src = code(ROUTE);
  assert.doesNotMatch(src, /randomBytes/, "no second token may be minted");
  assert.match(src, /where: \{ shareId \}/, "the existing shareId must be the capability");
});

// ═══ INVARIANT 2 — the flag gates everything ═══
test("the flag is checked before anything else happens", () => {
  const src = code(ROUTE);
  const flagAt = src.indexOf("livingCertificateFlagOn");
  const queryAt = src.indexOf("db.page.findUnique");
  assert.ok(flagAt > 0, "the route must consult the flag");
  assert.ok(queryAt > flagAt, "the flag must be checked before the database is touched");
});

test("only the exact string \"1\" turns the feature on", () => {
  assert.equal(livingCertificateFlagOn({ LIVING_CERTIFICATE: "1" }), true);
  for (const v of ["0", "true", "yes", "", undefined]) {
    assert.equal(livingCertificateFlagOn({ LIVING_CERTIFICATE: v }), false, `"${v}" must not enable`);
  }
  assert.equal(livingCertificateFlagOn({}), false);
});

// ═══ INVARIANT 1 — /c/{shareId} is untouched forever ═══
// Structural, not behavioural: if the existing renderer imports nothing from
// this feature, the feature cannot change what a client sees today.
test("the existing certificate view is independent of this feature", () => {
  for (const f of ["src/app/c/[shareId]/page.tsx", "src/components/qa/certificate-document.tsx"]) {
    const src = code(f);
    assert.doesNotMatch(src, /living-certificate/, `${f} must not import the living certificate`);
    assert.doesNotMatch(src, /livingCertificateEnabled/, `${f} must not read the flag column`);
    assert.doesNotMatch(src, /LIVING_CERTIFICATE/, `${f} must not read the env flag`);
  }
});
