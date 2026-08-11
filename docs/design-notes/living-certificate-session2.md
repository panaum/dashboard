# Living Certificate — Session 2 diagnosis (Step 0)

**Date:** 2026-08-11 · **Repo:** Dashboard · **Branch:** `feat/living-certificate-timeline-shape`
**Status:** ⏸ **Section 4 built (both repos). Stopped for review before Section 3.**

Session 1 shipped `Page.livingCertificateEnabled` (boolean, default false, applied
to production, 265 rows backfilled, drift-free — commit `bd30dd0`). This note is
the read-only diagnosis for the rendering work.

> **Revision, 2026-08-11.** The first draft of this note planned against a brief
> that put the Living Certificate inside `/c/{shareId}` on the Dashboard. The
> operator has since ruled that **the approved architecture stands**: the feature
> goes to **`/live/{shareId}` on the shell**, and **`/c/{shareId}` is untouched
> forever**. This note has been rewritten accordingly. §3 records what that
> reversal changed.

---

## 0. Operator decisions, 2026-08-11

| Q | Decision |
|---|---|
| **F1** route | **`/live/{shareId}` on the shell** (`qa-ecosystem`). `/c/{shareId}` untouched forever. `living-certificate.md` §9.1 stands; the earlier prompt was wrong |
| **F2** timeline | Acknowledged as a prerequisite. Sections 1/3/4 proceed without it. Recorded in the runbook |
| **F3** status reads | **Read-only sibling** to `getPageStatus()`, in-memory pattern. **No writes on the `/live/` path, ever** |
| **F4** snapshots | **Two-render equality** in the same run, not a golden file |
| **Scope** | **Option A** — Section 2 renders only whitelisted lifecycle events. Incidents deferred |

---

## 1. Summary — findings after the reversal

| # | Finding | Status |
|---|---|---|
| **F1** | Resolved — approved architecture reinstated. See §3 | ✅ settled |
| **F2** | LinkSpy timeline endpoint not merged to `main` | ⛔ **blocker for Section 2 only** |
| **F3** | `getPageStatus()` upserts `LinkSpyStatus` | ✅ mitigation agreed |
| **F4** | `/c/` renderer reads the wall clock | ✅ superseded — see §7 |
| **F5** | `getClientPresenceChips()` returns signed internal handoff links | ⚠️ must not enter the payload |
| **F7** | **The shell is Next 14 / React 18 / Tailwind v3.** The Dashboard is Next 16 / React 19 / Tailwind v4. **No component or design token is portable** | ⛔ **new — scope impact** |
| **F8** | **The shell's auth middleware is disabled today but designed to be re-enabled**, and its matcher would gate `/live/` | ⚠️ **new — landmine** |
| **F9** | **All three repos are public.** The shell must hold no service keys — architectural hygiene becomes a hard requirement | ℹ️ new |

---

## 2. The shell repo (`panaum/QA-Ecosystem`)

Read via the public GitHub API — **not cloned**, nothing fetched to disk.

| | |
|---|---|
| Name | `apexure-shell` · `panaum/QA-Ecosystem` |
| Visibility | **public** |
| Size | 41 KB — very small |
| Default branch | `main` @ `8b65306` (single branch) |
| Last push | 2026-08-03 |
| Stack | **Next 14.2** · **React 18.3** · next-auth 4.24 · **Tailwind v3** (`tailwind.config.ts`) |

```
app/api/auth/[...nextauth]/route.ts    lib/auth.ts
app/auth/signin/page.tsx               lib/handoff-contract.ts
app/go/[app]/route.ts                  components/DoorCard.tsx
app/page.tsx  app/layout.tsx           components/UserMenu.tsx
middleware.ts                          components/icons.tsx
```

It is a **launcher** — a three-doors page that signs handoff tokens and redirects
into the Dashboard and LinkSpy. It has **no database, no Prisma, no Supabase
client, and no service keys**, which is exactly what §9.3 of the approved note
depends on.

### F7 — nothing is portable (scope impact)

The Dashboard's certificate UI cannot be lifted across:

| | Dashboard | Shell |
|---|---|---|
| Next | 16 (App Router, Turbopack) | **14.2** |
| React | 19 | **18.3** |
| Tailwind | **v4**, CSS-first `@theme` in `globals.css` | **v3**, `tailwind.config.ts` |
| UI primitives | `Button`, `Card`, `Badge`, `StatusBadge`, `Avatar` | **none** |
| Design tokens | `bg-brand-primary`, `text-secondary`, … | **not defined** |

The four sections must be **written fresh against the shell's Tailwind v3 config**,
or the shell must first be upgraded and given the token set. Session 2's UI is
therefore new-build, not a port — the estimate should carry that. Reusable across
the boundary: **only pure TypeScript** with no React and no Tailwind, e.g.
[`timeline-shape.ts`](../../src/lib/living-certificate/timeline-shape.ts).

### F8 — the auth middleware landmine

`middleware.ts` today is a deliberate pass-through:

```ts
// Auth wall TEMPORARILY DISABLED — the shell is open …
//   export { default } from "next-auth/middleware";
//   export const config = { matcher: ["/((?!auth|api/auth|_next/static|…).*)"] };
export function middleware() { return NextResponse.next(); }
```

`/live/{shareId}` is client-facing and **must never require sign-in**. Today it
would be public by default — but the commented matcher excludes only
`auth|api/auth|_next/*|favicon.ico`, so **whoever re-enables the auth wall will
silently put a login page in front of every client's certificate**. The exclusion
must be added to that matcher in the same commit that adds the route, while the
reason is obvious.

---

## 3. What the F1 reversal changed

| Element | Under the (withdrawn) prompt | **Under the approved architecture** |
|---|---|---|
| Route | `/c/{shareId}` branches internally | **`/live/{shareId}`, new, on the shell** |
| `/c/{shareId}` | conditionally re-rendered | **untouched forever — zero diff** |
| Dashboard endpoint 1 | unnecessary (in-process compose) | **required** — the shell holds no keys |
| Repos touched | Dashboard only | **Dashboard + shell** (+ LinkSpy for F2) |
| Invariant 1 proof | two-render equality of `/c/` | **`git diff --exit-code`** on the `/c/` tree (§7) |
| Flag surfaces | Vercel `dashboard`, Railway | **+ Vercel `qa-ecosystem`** |

The reversal makes Invariant 1 **structurally** true rather than test-true: if no
file under `src/app/c/` or `certificate-document.tsx` changes, the existing view
cannot change. That also retires F4 — there is no longer a wall-clock snapshot to
stabilise, because there is no snapshot to take.

It costs one public HTTP hop (shell → Dashboard) that the withdrawn plan avoided.
That hop is what keeps service keys out of a public repo, so it is worth paying.

---

## 4. Architecture

```
                   Page.shareId  ← THE capability. Mint/revoke unchanged.
                        │
        ┌───────────────┴────────────────┐
        │                                │
  /c/{shareId}                    /live/{shareId}
  Dashboard · EXISTING            SHELL · NEW (Session 2)
  UNTOUCHED FOREVER               renders only when
                                  livingCertificateEnabled = true
                                        │
                                        │ server-side fetch, no keys
                                        ▼
                        GET /api/living-certificate/{shareId}
                        Dashboard · NEW · auth = the token itself
                                        │
                    ┌───────────────────┼────────────────────┐
                    ▼                   ▼                    ▼
              Dashboard DB        qa-bridge/status    registry-bridge/
              (Prisma, read)      client-presence     timeline  ⛔F2
                                  LinkSpy · qab_ service key
```

**Composition happens on the Dashboard**, because the Dashboard owns the token
and the service keys. The shell makes exactly one call and renders. `LINKSPY_API_KEY`
never leaves the Dashboard's server — mandatory now that F9 confirms every repo
is public.

---

## 5. Data inventory

| Section | Field | Source | New? |
|---|---|---|---|
| **1. Live health** | SSL, uptime, forms, tracking, links | `qa-bridge/status` | 🆕 |
| | incidents, fragility | `registry-bridge/client-presence` | 🆕 |
| **2. Timeline** | lifecycle events (Option A) | `registry-bridge/timeline` | 🆕 ⛔ **F2** |
| **3. Counters** | "38 checks holding" | `certificate.items[]` — Dashboard DB | ♻️ read |
| | "verified 4 hours ago" | `as_of` from `qa-bridge/status` | 🆕 |
| **4. Story mode** | days since delivery | `certificate.completedAt` — Dashboard DB | ♻️ read |
| | page + client name | Dashboard DB | ♻️ read |
| | uptime %, incidents handled | `registry-bridge/client-presence` | 🆕 |
| | "currently healthy" | `qa-bridge/status` | 🆕 |

⚠️ **"Reuse" changes meaning under the reversal.** On `/c/` those fields were
already in the render. On `/live/` the shell has no database, so **endpoint 1
must serialise them into its payload**. The Dashboard still reads them from its
own DB in one query; they are no longer free to the renderer.

**Addressing keys** — all already columns on rows endpoint 1 reads:
`Page.registryDeliverableId` (timeline), `Page.registrySiteId` (presence),
`Client.registryClientId` (presence).

### Existing helpers

| Helper | Endpoint | Cache | Writes? |
|---|---|---|---|
| [`getPageStatus()`](../../src/lib/linkspy/client.ts) | `qa-bridge/status` | 15 min, **`LinkSpyStatus` row** | ⚠️ **upserts — do not reuse (F3)** |
| [`getClientPresenceChips()`](../../src/lib/linkspy/client-presence-chips.ts) | `client-presence` | 60 s, in-memory `Map` | ✅ none — **the pattern to copy** |
| [`toClientTimeline()`](../../src/lib/living-certificate/timeline-shape.ts) | *(pure)* | — | ✅ none |

### F3 — the read-only sibling

```ts
// src/lib/linkspy/client.ts:62  — the line that must not run on this path
await db.linkSpyStatus.upsert({ where: { pageId: qaPageRef }, … })
```

`LinkSpyStatus` is an existing table; Invariant 3 forbids writing it. Worse, on a
public route an anonymous visitor would trigger a DB write per cache miss. The
sibling reads the cache row and fetches on miss **without persisting** —
in-memory 60 s only, mirroring `client-presence-chips.ts`. The internal page
keeps its writing helper untouched.

### F5 — do not leak handoff links

`getClientPresenceChips()` returns `{presence, hrefByChip}`; `hrefByChip` holds
HMAC-signed deep links into internal LinkSpy. **Endpoint 1 must serialise
`presence` only.** A grep test should assert `hrefByChip` never appears in the
living-certificate payload path.

---

## 6. Layout wireframe — `/live/{shareId}` on the shell

The four sections **are** the page. The shell has no `CertificateDocument` and
must not grow one (F7 makes a port impossible anyway, and a second renderer of
the same certificate is exactly the split-brain the approved note rejects).
**Recommendation: link to `/c/{shareId}` for the formal document — one renderer
each, no duplication.**

```
┌────────────────────────────────────────────────────────────────┐
│  ▸ SECTION 4 — STORY MODE HEADER                               │
│    Fautons Homepage                                            │
│    187 days since delivery · 99.8% uptime · 3 incidents handled│
│    ● Currently healthy                                         │
├────────────────────────────────────────────────────────────────┤
│  ▸ SECTION 1 — LIVE HEALTH STRIP                               │
│   ┌──────┬──────┬───────┬──────────┬───────┐                   │
│   │ SSL  │Uptime│ Forms │ Tracking │ Links │                   │
│   │  ✅  │  ✅  │  ✅   │    ✅    │  ⚠️   │                   │
│   │valid │99.8% │  ok   │  active  │2 dead │                   │
│   └──────┴──────┴───────┴──────────┴───────┘                   │
├────────────────────────────────────────────────────────────────┤
│  ▸ SECTION 3 — CONTINUOUS VERIFICATION                         │
│    38 checks holding · verified 4 hours ago                    │
├────────────────────────────────────────────────────────────────┤
│  ▸ SECTION 2 — HISTORY TIMELINE          ⛔ blocked on F2      │
│    ┌──────────────────────────────────────────────┐            │
│    │ 12 Feb 2026 · Quality assurance signed off   │            │
│    │              38 checks passed                │            │
│    ├──────────────────────────────────────────────┤            │
│    │ 08 Feb 2026 · Handed to quality assurance    │            │
│    └──────────────────────────────────────────────┘            │
│    Option A: whitelisted lifecycle events only, newest first   │
├────────────────────────────────────────────────────────────────┤
│  → View the formal QA certificate  (links to /c/{shareId})     │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. Fetch plan

```
SHELL  /live/{shareId}                     Next 14 server component
  │
  └─1 fetch → DASHBOARD /api/living-certificate/{shareId}
               60 s revalidate · no keys held by the shell
                 │
                 ├─ GATE  LIVING_CERTIFICATE=1 ?           → 404 if unset
                 ├─ DB    page.findUnique({ shareId })     → 404 if unresolved
                 ├─ GATE  livingCertificateEnabled ?       → 404 if false
                 │
                 └─ Promise.allSettled([                    ← parallel
                      statusReadOnly(page.id),        // §5 F3
                      presence(client.registryClientId),
                      timeline(page.registryDeliverableId), // ⛔ F2
                    ])
                    60 s in-memory · 4 s timeout · staleness over errors
                    each rejection hides ONLY its own section
```

**Parallel, not sequential** — the three LinkSpy reads are all keyed off values
present after the single DB query, so none waits on another. A `404` is the
uniform answer for *flag off*, *bad token*, and *not enabled*, so the endpoint
never reveals which of the three was the case.

---

## 8. Invariant proofs

| Invariant | How it is proven |
|---|---|
| **1** — zero change to `/c/{shareId}` | **`git diff --exit-code` over `src/app/c/` and `certificate-document.tsx`** at PR time. Nothing to snapshot: the files do not change |
| **2** — `LIVING_CERTIFICATE=1` gates everything | Flag-off tests on all three surfaces: endpoint 1 → 404, `/live/` → 404, existing views unchanged |
| **3** — read-only | Grep test: no `db.*.create/update/upsert/delete` reachable from the living-certificate path. Extends the pattern already passing in `prefill-provenance.test.ts` and `isolation.test.ts` |
| **4** — one token, one revoke | `revokeShareLink()` nulls `shareId` → `/c/` **and** `/live/` both 404. No second token exists |

### State tests

| # | `LIVING_CERTIFICATE` | `livingCertificateEnabled` | `/c/{shareId}` | `/live/{shareId}` |
|---|---|---|---|---|
| 1 | unset | `false` | unchanged | 404 |
| 2 | unset | `true` | unchanged | 404 — **column ignored entirely** |
| 3 | `1` | `false` | unchanged | 404 |
| 4 | `1` | `true` | **unchanged** | four sections |
| 5 | `1` | `true`, LinkSpy down | unchanged | sections degrade individually, no 500 |
| 6 | `1` | `true`, timeline 404 (F2) | unchanged | 1/3/4 render, 2 hidden |
| 7 | any | `shareId` revoked | 404 | 404 |

In all seven: **zero writes** to `Page`, `QACheckItem`, `QACertificate`, `Issue`,
`LinkSpyStatus`, or any tester-owned record.

---

## 9. Prerequisites before Session 2 code

1. ✅ **Shell repo** — already present at `/Users/apexure/qa-ecosystem` (§12).
2. ⛔ **F2** — merge `f280398` to LinkSpy `main`, deploy to Railway, set
   `LIVING_CERTIFICATE=1` there. **Section 2 only.** Recorded in
   [docs/runbooks/living-certificate.md](../runbooks/living-certificate.md).
3. `LIVING_CERTIFICATE=1` on Vercel `dashboard` (endpoint 1) and Vercel
   `qa-ecosystem` (the `/live/` route). **Not set by me** — the brief forbids
   enabling the flag.
4. `DASHBOARD_URL` already exists in the shell's `.env.example`; endpoint 1 is
   reachable at that origin, so no new shell secret is needed.

---

## 10. Cloning the shell — access report

Verified read-only, **no clone performed**:

| Check | Result |
|---|---|
| `gh` CLI | ✅ installed (2.97.0) — **not logged in**, and **not needed** for git over SSH |
| SSH key | ✅ `~/.ssh/id_ed25519.pub` |
| `ssh -T git@github.com` | ✅ *"Hi panaum! You've successfully authenticated"* |
| `git ls-remote` over SSH | ✅ `main` @ `8b65306` |
| `git ls-remote` over HTTPS, anonymous | ✅ succeeds — the repo is public |
| Credential helper | ✅ `osxkeychain` (system gitconfig) |

**No access blocker exists.** Both transports work today. Recommended:

```zsh
git clone git@github.com:panaum/QA-Ecosystem.git /Users/apexure/qa-ecosystem
cd /Users/apexure/qa-ecosystem && npm install
cp .env.example .env.local     # then fill in — see below
```

To run it locally, `.env.local` needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `SPINE_SECRET` (must equal the Dashboard's and
LinkSpy's), `DASHBOARD_URL`, `LINKSPY_URL`. For `/live/` work only `DASHBOARD_URL`
is load-bearing — the auth wall is off (F8), so the other values can stay at their
example defaults until sign-in is re-enabled.

⚠️ Both apps default to **port 3000**. Running the shell against a local Dashboard
means moving one of them (`next dev -p 3001`).

---

## 11. Tripwire status

| Tripwire | Status |
|---|---|
| **T1** non-additive DDL | ✅ none — no DDL this session |
| **T4** unattended writes | ✅ prevented by the F3 sibling; grep-enforced (§8) |
| **T5** exit test fails after one fix | — not reached |
| **T7** changes existing UI | ✅ **structurally impossible** — `/c/` is not edited at all |
| **T8** changes existing endpoint shapes | ✅ none — all three LinkSpy endpoints consumed as-is |

---

## 12. Section 4 — story mode header (BUILT)

Shipped across both repos. Sections 1–3 not started.

### Wireframe — as built

Only the delivery age is known today. The vitals are wired by Section 1; until
then their clauses are **absent**, not zeroed.

```
┌────────────────────────────────────────────────────────────┐
│  FAUTONS                              ← client, overline   │
│  Fautons Homepage                     ← page, display font │
│  180 days since delivery                                   │
│                                                            │
│  [ once Section 1 lands, the same line becomes: ]          │
│  180 days since delivery · 99.8% uptime · 3 incidents      │
│  ● Currently healthy                                       │
└────────────────────────────────────────────────────────────┘
```

**The load-bearing rule:** a null field is dropped, never rendered as `0` or
`—`. "0% uptime" on a client's certificate is a false and alarming claim; saying
nothing is correct. Zero itself is real data and survives — `0 incidents handled`
renders, `null` does not.

### Fetch plan — as built

```
SHELL   /live/{shareId}                        Next 14 server component
  │     fetchLivingCertificate(shareId)
  │       60 s revalidate · 6 s timeout · no keys held
  │       404 → notFound()   ·   5xx/network → quiet "temporarily unavailable"
  ▼
DASHBOARD  GET /api/living-certificate/{shareId}      force-dynamic
  1. livingCertificateFlagOn()      → 404 if LIVING_CERTIFICATE ≠ "1"
  2. db.page.findUnique({ shareId }) — ONE read, no writes
  3. !page || !livingCertificateEnabled → 404   (uniform with 1)
  4. buildStory({ pageName, clientName, signedOffAt }, new Date())
  → { as_of, story, live_health: null, timeline: null, verification: null }
```

No LinkSpy call is made for Section 4 — every field comes from the Dashboard's
own database, which is why it went first.

### Response contract

`live_health` / `timeline` / `verification` are **present and null** from day
one. Sections 1–3 fill them in; no consumer ever sees the response shape change
(T8). The addressing keys (`registrySiteId`, `registryDeliverableId`,
`registryClientId`) are already read by the query, so those sections need no
second query.

⚠️ **The contract is duplicated across repos** — Next 16/React 19 here, Next
14/React 18 there, no shared package (F7). `lib/living-certificate.ts` on the
shell mirrors the route's response by hand. Mitigation is discipline: additive
keys only, meanings never change, so an older shell keeps rendering against a
newer Dashboard.

### Files

| Repo | File | Purpose |
|---|---|---|
| Dashboard | `src/lib/living-certificate/flag.ts` | the kill switch, injectable env |
| Dashboard | `src/lib/living-certificate/story-shape.ts` | pure; `now` injected, no clock read |
| Dashboard | `src/app/api/living-certificate/[shareId]/route.ts` | the composing endpoint |
| Dashboard | `…/story-shape.test.ts`, `…/isolation.test.ts` | 12 unit + 7 invariant tests |
| Shell | `lib/living-certificate.ts` | the one fetch + mirrored types |
| Shell | `lib/story-clauses.ts` | pure null-omission rule |
| Shell | `components/StoryHeader.tsx` | presentational only |
| Shell | `app/live/[shareId]/page.tsx` | the route |
| Shell | `middleware.ts` | **F8 exclusion** (`PUBLIC_EXEMPT`) |

### Test results

| Suite | Result |
|---|---|
| Dashboard `npm test` | **182 pass, 0 fail** (34 living-certificate) |
| Shell `npm test` | **9 pass, 0 fail** |
| Dashboard `tsc --noEmit` | clean |
| Shell `tsc --noEmit` | clean |
| Dashboard `npm run build` | ✅ route registered as `ƒ /api/living-certificate/[shareId]` |
| Shell `npm run build` | ✅ `ƒ /live/[shareId]`, 138 B |
| **Invariant 1** | `git diff --exit-code origin/main -- src/app/c/ certificate-document.tsx` → **no diff** |

Shell tests run on **Node's built-in type stripping** — no test framework and no
new dependency in that repo. This is why `storyClauses` lives in a `.ts` module
rather than inside the `.tsx` component: JSX cannot be stripped, plain types can.

### Deviations worth knowing

1. **The shell repo was already cloned** at `/Users/apexure/qa-ecosystem`, at
   `origin/main`, with `node_modules` installed. §10's earlier "not on this
   machine" was inherited from the older note and was wrong. No clone or
   `npm install` was needed.
2. **Section 4 renders Dashboard-only fields.** Uptime, incidents and health are
   LinkSpy-sourced and arrive with Section 1 — as the operator's ordering
   intended. The header is complete and correct today; it simply says less.
3. **The shell is dark.** Its tokens (`ink-*`, `signal`, `teal`) are the opposite
   of the Dashboard's light certificate. Following the repo you are in is the
   right call, but `/live/` and `/c/` will not look like siblings. Flagging as a
   design question for Section 1, not a defect.
4. **`npm run lint` is unconfigured on the shell** — `next lint` prompts to set
   ESLint up interactively. Left alone as out of scope; typecheck, build and
   tests cover the new code.
5. **`tsconfig.json` gained `allowImportingTsExtensions`** on the shell, required
   because Node's stripper resolves real files. Safe under the existing `noEmit`.

---

## 13. Deferred to Session 3+

The operator-facing **enable toggle** (a server action beside `createShareLink` /
`revokeShareLink`), **custom domain**, **analytics**, and **incident cards** in
Section 2 (Option B — revisit if the narrative reads as incomplete in real use).

---

**STOP.** Section 4 is built and tested in both repos (§12). Awaiting review
before Section 3 (verification counters).
