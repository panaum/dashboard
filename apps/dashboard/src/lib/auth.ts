import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "./db";
import { type Actor, type Capability, type Rank, CANNOT, RANKS, RANK_LABELS, can } from "./permissions";
import { PREVIEW_COOKIE, type PreviewTarget, isPreviewableRank, makePreviewToken, readPreviewToken } from "./preview";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  return process.env.AUTH_SECRET ?? "dev-secret";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

// The payload names the subject: a member id, or the literal "team" for the
// shared-password bootstrap session. Before this, every session carried the
// same bytes, which is why nothing in the app could be attributed to anyone.
function makeToken(subject = "team") {
  const payload = `${subject}:${MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

/** The verified subject of the current cookie, or null. Signature first — the
 *  subject is attacker-supplied text until the HMAC checks out. */
function subjectOf(token: string | undefined): string | null {
  if (!isValid(token)) return null;
  const payload = token!.slice(0, token!.lastIndexOf("."));
  const sep = payload.lastIndexOf(":");
  return sep > 0 ? payload.slice(0, sep) : null;
}

function isValid(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function checkPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected || password.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(password), Buffer.from(expected));
}

/** Hash a password for storage. scrypt with a per-password random salt; the
 *  salt travels with the hash so no second column is needed. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false; // no password set = cannot sign in
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Sign in as a person. Returns the member id on success, null otherwise —
 *  deliberately not distinguishing "no such email" from "wrong password". */
export async function checkMemberPassword(
  email: string,
  password: string,
): Promise<string | null> {
  const member = await db.teamMember.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true, active: true },
  });
  if (!member || !member.active) return null;
  return verifyPassword(password, member.passwordHash) ? member.id : null;
}

export async function createSession(memberId?: string) {
  const store = await cookies();
  store.set(COOKIE, makeToken(memberId ?? "team"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValid(store.get(COOKIE)?.value);
}

/** Who is acting, or null. The shared-password session resolves to a bootstrap
 *  admin so that adopting this change cannot lock you out of your own tool — it
 *  can manage the team, but `canSignQa` refuses it, because a signature nobody
 *  can be held to is worthless. */
export async function getActor(): Promise<Actor | null> {
  const store = await cookies();
  const subject = subjectOf(store.get(COOKIE)?.value);
  if (!subject) return null;
  const real = await actorFor(subject);
  if (!real) return null;
  return (await previewOf(real, subject, store.get(PREVIEW_COOKIE)?.value)) ?? real;
}

async function actorFor(subject: string): Promise<Actor | null> {
  if (subject === "team") {
    return { id: "bootstrap", name: "Shared team login", rank: "ADMIN", bootstrap: true };
  }
  const member = await db.teamMember.findUnique({
    where: { id: subject },
    select: { id: true, name: true, rank: true, active: true },
  });
  // A deactivated person's cookie stops working immediately, without waiting
  // for the 30-day expiry.
  if (!member || !member.active) return null;
  const rank = (RANKS as readonly string[]).includes(member.rank)
    ? (member.rank as Rank)
    : "VIEWER"; // unknown rank fails closed, never open
  return { id: member.id, name: member.name, rank };
}

// ── view as ─────────────────────────────────────────────────────────────────
// An admin previewing the app as a rank, or as one person. The previewed
// actor flows through every existing check — nav, buttons, data — so there is
// one implementation of "what a rank sees", reached two ways. Honoured only
// while the real session holds rank:assign; a cookie minted by someone else,
// or kept after a demotion, does nothing.

async function previewOf(real: Actor, subject: string, token: string | undefined): Promise<Actor | null> {
  if (!token || !can(real, "rank:assign")) return null;
  const target = readPreviewToken(token, subject, secret());
  if (!target) return null;

  let seen: Actor;
  if (target.kind === "rank") {
    // A rank in general, not a person: an id no row has, so nothing personal
    // (unread cards, onboarding, "you built this") belongs to it.
    seen = { id: "preview", name: RANK_LABELS[target.rank], rank: target.rank };
    seen.preview = { label: RANK_LABELS[target.rank], realName: real.name };
  } else {
    const m = await db.teamMember.findUnique({
      where: { id: target.memberId }, select: { id: true, name: true, rank: true, active: true },
    });
    if (!m || !m.active || !isPreviewableRank(m.rank)) return null;
    seen = { id: m.id, name: m.name, rank: m.rank };
    seen.preview = { label: `${m.name} (${RANK_LABELS[m.rank]})`, realName: real.name };
  }
  // Read-only, enforced here: a request that could change something gets an
  // actor for whom can() is always false. Server actions carry a Next-Action
  // header; a form posted without JavaScript carries a form body.
  const h = await headers();
  const ct = h.get("content-type") ?? "";
  if (h.has("next-action") || /multipart\/form-data|x-www-form-urlencoded/.test(ct)) seen.readOnly = true;
  return seen;
}

/** Start previewing. The caller has checked rank:assign. */
export async function startPreviewCookie(target: PreviewTarget) {
  const store = await cookies();
  const subject = subjectOf(store.get(COOKIE)?.value);
  if (!subject) return;
  store.set(PREVIEW_COOKIE, makePreviewToken(subject, target, secret()), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/",
    maxAge: 60 * 60 * 8, // a working day; a forgotten preview ends on its own
  });
}

export async function endPreviewCookie() {
  const store = await cookies();
  store.delete(PREVIEW_COOKIE);
}

export async function requireAuth(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Guard a page or server action on a capability rather than a rank string. */
export async function requireCapability(capability: Capability): Promise<Actor> {
  const actor = await requireAuth();
  if (!can(actor, capability)) redirect("/dashboard");
  return actor;
}

/** For server actions: the actor if they hold the capability, else null. An
 *  action answers "no" with an error the form can show, not a redirect —
 *  this is the one shared guard, so every action refuses the same way. */
export async function actorWith(capability: Capability): Promise<Actor | null> {
  const actor = await getActor();
  return can(actor, capability) ? actor : null;
}

/** The sentence an action refuses with. During a preview the rank is not
 *  the reason — the preview is — so it says that instead of blaming an
 *  access level the previewed person may well have. */
export async function refusal(capability: Capability): Promise<string> {
  const actor = await getActor();
  return actor?.preview ? "This is a preview — nothing is saved." : CANNOT[capability];
}

/** For API routes that change something: 401 without a session, 403 without
 *  the capability, null to proceed. Reads stay on requireApiAuth — every
 *  signed-in rank may read. */
export async function requireApiCapability(capability: Capability): Promise<Response | null> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  // A route handler's method is not visible to getActor, and these are the
  // write handlers, so a preview is refused here outright: read-only.
  if (actor.preview || !can(actor, capability)) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

// Guard for internal API routes. `src/proxy.ts` only matches /dashboard/* and
// only sniffs for the cookie's presence, so route handlers under /api that serve
// team-only data must verify the signature themselves — a redirect is the wrong
// answer for a fetch(), so this returns 401 JSON instead.
//
// Not for: the service-authed bridges (registry-bridge, spine/*) or the public
// share-token routes (/api/living-certificate/[shareId]), which carry their own
// credentials by design.
export async function requireApiAuth(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
