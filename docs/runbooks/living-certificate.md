# Runbook — Living Certificate

Activation order, prerequisites, and rollback for the Living Certificate
(`/live/{shareId}` on the shell). Design: [living-certificate-session2.md](../design-notes/living-certificate-session2.md).

**Status: not activated.** `LIVING_CERTIFICATE` is unset on every surface, so
nothing below is live yet.

---

## The one thing to know

**Section 2 (history timeline) renders nothing until two prerequisite steps are
done, and they are in the LinkSpy repo, not this one.** Sections 1, 3 and 4 do
not depend on them and will render as soon as the Dashboard and shell flags are
on.

This is by design, not a bug: a missing timeline endpoint answers `404`, the
Living Certificate hides that one section, and every other section still renders.
Do not read a missing timeline as a broken deployment before checking the two
steps below.

### Section 2 prerequisites

| # | Step | Repo | Verify |
|---|---|---|---|
| 1 | Merge `f280398` (*feat(living-certificate): read endpoint for client_timeline*) to `main` | LinkSpy (`brokenlinkchecker`) | `git show origin/main:backend/main.py \| grep 'registry-bridge/timeline'` returns a hit |
| 2 | Deploy to Railway **and** set `LIVING_CERTIFICATE=1` there | LinkSpy · Railway | `GET /api/registry-bridge/timeline?registry_deliverable_id=<uuid>` with a `qab_` key returns `200`, not `404` |

**Verified 2026-08-11 (later):** step 1 is DONE — the endpoint is merged and
deployed. Step 2 is NOT: an unauthenticated probe returns
`404 {"error":"living_certificate_disabled"}`, which is the route's own flag gate
answering before authentication. The route exists; `LIVING_CERTIFICATE` is unset
on Railway.

A third prerequisite, not previously listed: **no page carries a
`registryDeliverableId` (0 of 265)**, so even with the flag on every page returns
`timeline: null`. Deliverables must be registered with LinkSpy before the section
has anything to show.

---

## Activation order

Strictly in this order. Each step is independently reversible.

| # | Surface | Action | Effect |
|---|---|---|---|
| 1 | LinkSpy · Railway | merge + deploy + `LIVING_CERTIFICATE=1` | timeline endpoint answers. Nothing client-facing yet |
| 2 | Vercel `dashboard` | `LIVING_CERTIFICATE=1` | `/api/living-certificate/{shareId}` answers. Still nothing client-facing — no page renders it |
| 3 | Vercel `qa-ecosystem` | `LIVING_CERTIFICATE=1` | `/live/{shareId}` renders **for pages already opted in** |
| 4 | Dashboard UI | set `livingCertificateEnabled = true` per page | that page's living certificate goes live |

Steps 1–3 are safe with no page opted in: with `livingCertificateEnabled` false
everywhere (its default, and true for all 265 rows today), step 3 changes nothing
a client can see. **Step 4 is the only client-visible moment.**

---

## Rollback

| Symptom | Action | Blast radius |
|---|---|---|
| One page should not be live | `livingCertificateEnabled = false` | that page only. `/live/` 404s |
| The feature misbehaves | unset `LIVING_CERTIFICATE` on Vercel `qa-ecosystem` | all `/live/` 404s. No data touched |
| Suspected data leak | unset `LIVING_CERTIFICATE` on Vercel `dashboard` | endpoint 1 404s; every `/live/` degrades to 404 |
| A client link must die entirely | `revokeShareLink()` — existing action | **both** `/c/` and `/live/` 404. One token, one revoke |
| Schema reversal | `ALTER TABLE "Page" DROP COLUMN "livingCertificateEnabled"` | no dependent objects. `/c/` unaffected — it never read the column |

Rollback never requires a deploy: every step is an env var or a row update.

---

## Invariants this feature must not break

1. **`/c/{shareId}` is untouched forever.** Enforced at PR time by
   `git diff --exit-code` over `src/app/c/` and `certificate-document.tsx`.
2. **`LIVING_CERTIFICATE` off ⇒ the column is ignored entirely** and every
   existing view is byte-identical.
3. **Read-only.** No writes to any existing table from the `/live/` path — in
   particular **not** `LinkSpyStatus`, which the internal `getPageStatus()`
   upserts and which the living-certificate path must therefore not reuse.
4. **One capability.** `Page.shareId` remains the only token. The boolean selects
   a rendering; it does not grant access.

---

## Gotchas

- **The shell's auth middleware is a pass-through today** but is written to be
  re-enabled. Its commented matcher does **not** exclude `/live/`, so restoring
  the auth wall would put a sign-in page in front of every client certificate.
  Add the exclusion in the same commit as the route.
- **All three repos are public.** No service key may ever reach the shell; it
  holds none today and must keep holding none. Composition stays on the Dashboard.
- **A `404` from `/live/` is ambiguous on purpose** — flag off, unknown token, and
  not-enabled all answer identically, so the endpoint never reveals which.
- **Both apps default to port 3000.** Locally, run one on `-p 3001`.
