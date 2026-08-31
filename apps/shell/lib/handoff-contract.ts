// ═══════════════════════════════════════════════════════════════════════════
// SPINE HANDOFF v1 — the EXACT signing contract from Phase 4, copied verbatim.
// The shell SIGNS tokens; the Dashboard and LinkSpy /handoff endpoints VERIFY
// them (same file lives in both apps). HANDOFF_CHECKSUM must match all three.
//
// Token = base64url(JSON{target_path, exp, nonce}) + "." + hmacSha256Hex(SECRET, body)
// URL   = {base}/handoff?token=<urlencoded token>
// The token removes friction; it is NOT auth. Sign SERVER-SIDE only.
// ═══════════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const HANDOFF_CHECKSUM =
  "90b6a00da54c193c9142e31d8d8529a718dbb7933825b18f27162418a9ac7374";
export const HANDOFF_MAX_TTL_S = 300; // ≤ 5 minutes

type Payload = { target_path: string; exp: number; nonce: string };

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signHandoff(targetPath: string, secret: string, nowSeconds: number, ttlS = HANDOFF_MAX_TTL_S): string {
  const exp = nowSeconds + Math.min(ttlS, HANDOFF_MAX_TTL_S);
  const payload: Payload = { target_path: targetPath, exp, nonce: randomBytes(8).toString("hex") };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyHandoff(
  token: string, secret: string, nowSeconds: number,
): { ok: true; targetPath: string } | { ok: false; reason: string } {
  if (!token || !token.includes(".")) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  let payload: Payload;
  try { payload = JSON.parse(unb64url(body)); } catch { return { ok: false, reason: "bad payload" }; }
  if (typeof payload.target_path !== "string" || !payload.target_path.startsWith("/")) return { ok: false, reason: "bad target" };
  if (typeof payload.exp !== "number" || nowSeconds > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, targetPath: payload.target_path };
}

// Full handoff URL: {base}/handoff?token=… — always sign SERVER-SIDE.
export function handoffUrl(base: string, targetPath: string, secret: string, nowSeconds: number): string {
  const token = signHandoff(targetPath, secret, nowSeconds);
  return `${base.replace(/\/$/, "")}/handoff?token=${encodeURIComponent(token)}`;
}
