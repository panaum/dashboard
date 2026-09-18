// A REPORT LINK A CLIENT CAN OPEN.
//
// The client report is written for whoever owns the site, and it lives behind
// the team login — so the deliverable has been a screenshot of it. A share link
// is a signed token naming one run, valid for a fortnight: the page it opens
// shows that run's report and nothing else, and the token is the only thing
// the reader needs. Signed rather than stored, so it needs no schema and no
// secret is ever written down; expiring rather than revocable, because a
// report is a snapshot — a fortnight is long enough to read and act on it,
// and after that the next run is the one to send.
//
// The signature is the same shape as the handoff tokens (handoff-contract.ts):
// base64url payload, dot, hex HMAC-SHA256. The secret is SPINE_SECRET, which
// every deployment has (INFRASTRUCTURE.md) — never a default: a link signed
// with a guessable key is a public page.
//
// Pure: the secret and the clock are passed in, so every rule is tested.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const REPORT_LINK_TTL_S = 14 * 24 * 60 * 60;

type Payload = { run: string; exp: number; nonce: string };

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** A token for one run. Throws on an empty secret: there is no safe default. */
export function signReportLink(runId: string, secret: string, nowSeconds: number, ttlS = REPORT_LINK_TTL_S): string {
  if (!secret) throw new Error("report links need a secret");
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(runId)) throw new Error("not a run id");
  const payload: Payload = { run: runId, exp: nowSeconds + Math.min(ttlS, REPORT_LINK_TTL_S), nonce: randomBytes(6).toString("hex") };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export type Verified = { ok: true; runId: string; exp: number } | { ok: false; reason: "malformed" | "bad signature" | "expired" | "no secret" };

/** Which run a token opens, or why it opens nothing. */
export function verifyReportLink(token: string, secret: string, nowSeconds: number): Verified {
  if (!secret) return { ok: false, reason: "no secret" };
  if (!token || token.length > 512 || !token.includes(".")) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"))) return { ok: false, reason: "bad signature" };
  let payload: Payload;
  try { payload = JSON.parse(unb64url(body)) as Payload; } catch { return { ok: false, reason: "malformed" }; }
  if (typeof payload?.run !== "string" || typeof payload?.exp !== "number") return { ok: false, reason: "malformed" };
  if (payload.exp <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, runId: payload.run, exp: payload.exp };
}

/** The clock, read here rather than in a component: a page that reads it in
 *  render trips the purity rule, and the verification wants seconds anyway. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** How the link reads to the person copying it. */
export function expiryWords(exp: number, nowSeconds: number): string {
  const days = Math.max(0, Math.round((exp - nowSeconds) / 86400));
  return days === 0 ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} days`;
}
