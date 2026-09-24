// VIEW AS — the admin preview token.
//
// Pure (the HMAC key is passed in), so the format is unit tested without a
// request. The cookie names what to preview — a rank in general, or one
// person — and the admin session it belongs to. getActor() honours it only
// when that same session still holds rank:assign, so a copied cookie is
// worthless to anyone else and a demoted admin's preview simply stops.

import { createHmac, timingSafeEqual } from "node:crypto";
import { RANKS, type Rank } from "./permissions";

export const PREVIEW_COOKIE = "preview";

/** What to render as. Admin is not a preview target: it is what you are. */
export type PreviewTarget = { kind: "rank"; rank: Exclude<Rank, "ADMIN"> } | { kind: "member"; memberId: string };

const PREVIEWABLE: readonly string[] = RANKS.filter((r) => r !== "ADMIN");

export function isPreviewableRank(r: string): r is Exclude<Rank, "ADMIN"> {
  return PREVIEWABLE.includes(r);
}

const sign = (payload: string, key: string) => createHmac("sha256", key).update(`preview:${payload}`).digest("hex");

/** `<ownerSubject>|rank:VIEWER` or `<ownerSubject>|member:<id>`, then `.sig`.
 *  The owner is the session's subject (a member id, or "team"). */
export function makePreviewToken(owner: string, target: PreviewTarget, key: string): string {
  const what = target.kind === "rank" ? `rank:${target.rank}` : `member:${target.memberId}`;
  const payload = `${owner}|${what}`;
  return `${payload}.${sign(payload, key)}`;
}

/** The target, if the token is genuine AND belongs to this owner; else null. */
export function readPreviewToken(token: string | undefined, owner: string, key: string): PreviewTarget | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, key));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

  const bar = payload.indexOf("|");
  if (bar < 0 || payload.slice(0, bar) !== owner) return null;
  const what = payload.slice(bar + 1);
  if (what.startsWith("rank:")) {
    const r = what.slice(5);
    return isPreviewableRank(r) ? { kind: "rank", rank: r } : null;
  }
  if (what.startsWith("member:") && what.length > 7) return { kind: "member", memberId: what.slice(7) };
  return null;
}
