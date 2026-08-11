# Living Certificate — Session 2 diagnosis (Step 0)

**Date:** 2026-08-11 · **Repo:** Dashboard · **Branch:** `feat/living-certificate-timeline-shape`
**Status:** ⏸ **Sections 4 + 3 built, palette ported. Section 1 + the Section 4
per-site reword are PLANNED (§§16–17) and awaiting review. No code written for either.**

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
| **F11** scope | **Option B** — Section 4's uptime/incidents become **per-site**, not per-client. Copy reworded to say so (§16) |

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
| **F10** | **The shell must never reach LinkSpy.** `/live/` is unauthenticated, so its payload is readable by anyone the link reaches. Compose on the Dashboard, expose derived states only | ⛔ **hard constraint on Section 1** — see §15 |
| **F11** | **`client-presence` is client-level; the share token is page-level.** Piping it through would let one page's link reveal every site that client owns | ⛔ **blocks the naive Section 1** — see §15 |

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

## 13. Palette port — Option A (BUILT)

Operator decision, 2026-08-11: **Option A.** Port the certificate's neutrals and
indigo into the shell, scoped to `/live/` only, so a client following both links
sees one company.

### The tokens brought across

Copied **verbatim** from the Dashboard's `@theme` block
([src/app/globals.css](../../src/app/globals.css)) into the shell's
`tailwind.config.ts` under an `lc` namespace. No value was re-picked or
approximated — a near-match would read as a different brand, which is the whole
failure being avoided.

| Role | Dashboard token | Hex | Shell utility |
|---|---|---|---|
| Page ground | `--color-page` | `#f6f6f9` | `bg-lc-page` |
| Card | `--color-card` | `#ffffff` | `bg-lc-card` |
| Card, sunk | `--color-card-soft` | `#f1f1f6` | `bg-lc-card-soft` |
| Accent (indigo) | `--color-accent` | `#4f46e5` | `bg-lc-accent` |
| Text, primary | `--color-text-primary` | `#1c1c2e` | `text-lc-text` |
| Text, secondary | `--color-text-secondary` | `#66667a` | `text-lc-secondary` |
| Text, muted | `--color-text-muted` | `#7a7a8c` | `text-lc-muted` |
| Border | `--color-border-soft` | `#e8e8f0` | `border-lc-line` |
| Success | `--color-success` | `#4caf7d` | `text-lc-success` |
| Warning | `--color-warning` | `#f5a623` | `text-lc-warning` |
| Error | `--color-error` | `#e05c5c` | `text-lc-error` |
| Shadow | `--shadow-sm` | `0 1px 2px rgba(20,20,43,.04), 0 2px 6px rgba(20,20,43,.05)` | `shadow-lc` |

Two rules could not be Tailwind tokens, because the shell's `body` paints a dark
radial gradient and `:root` declares `color-scheme: dark`. Both are overridden in
`app/globals.css`, keyed on `.lc-root`:

```css
html:has(.lc-root) { color-scheme: light; }
body:has(.lc-root) { background: #f6f6f9; color: #1c1c2e; }
```

`:has()` rather than a full-bleed wrapper, so overscroll and short pages stay
light too — a wrapper leaves the gradient showing above and below the fold.

### No cross-contamination — how it is guaranteed

Three independent mechanisms, the last of which is enforced by a test:

1. **Namespacing.** Every ported value is `lc-*`. Adding a token cannot change a
   surface that never references it.
2. **A single scope door.** `app/live/layout.tsx` is the only file that sets
   `lc-root`. Delete it and the shell is exactly as dark as it was.
3. **`lib/scope.test.ts`** — asserts that no file outside `app/live/`,
   `StoryHeader.tsx` and `VerificationCounters.tsx` uses `lc-root` or any
   `{bg,text,border,shadow,font,…}-lc` utility; that exactly one file sets the
   scope; that the shell's dark tokens and doors gradient survive intact; and
   that the light hex appears **only** inside a `:has(.lc-root)` rule.

**Verified at runtime**, not just by grep — computed `body` background:

| Route | `getComputedStyle(body).backgroundColor` |
|---|---|
| `/live/{shareId}` | `rgb(246, 246, 249)` ✅ light |
| `/` (doors) | `rgb(8, 8, 12)` ✅ unchanged |

### Typography — unified, no contrast to name

`/live/` uses **Geist**, via the same `geist/font/sans` package the Dashboard
loads in its own root layout. It is **not** Bricolage Grotesque.

Bricolage is the *shell's* voice — the parent frame around three staff doors —
and a client never sees that frame. On a client-facing certificate the only
useful signal is that `/c/{shareId}` and `/live/{shareId}` come from the same
company, and matching the type is the cheapest way to say it. A contrast here
would be decorative rather than meaningful, so there is none to name.

⚠️ **This added one dependency to the shell** (`geist@1.7.2`). Next 14's
`next/font/google` has no Geist entry, so the package was the only route to the
real face; the alternative was Inter, which is *close to* Geist and would have
undercut the entire point of the port. Scoped to the `/live/` layout — the doors
page still loads Bricolage and Inter and nothing else.

---

## 14. Section 3 — continuous verification counters (BUILT)

### Wireframe — as built

```
┌────────────────────────────────────────────────────────────┐
│  CONTINUOUS VERIFICATION                                   │
│                                                            │
│  38  of 39 checks holding                                  │
│  ████████████████████████████████████████████████░░        │
│  ● 1 needs attention  ·  last checked 6 days ago           │
└────────────────────────────────────────────────────────────┘
```

The ratio is encoded in **form as well as number** — the bar turns
`lc-success` green only when everything holds, and stays `lc-accent` indigo
otherwise, so the state reads without dividing two figures.

### Fetch plan — no new fetch at all

Section 3 makes **zero** LinkSpy calls. Both inputs were already reachable from
the Dashboard's own database, and the existing query was widened by two selects:

```
certificate.items { result }      → holding / needs_attention / total
linkspyStatus     { fetchedAt }   → "last checked N days ago"
```

`linkspyStatus.fetchedAt` is read through the `Page` relation — **a read, not a
write**. The row is maintained by the internal page's `getPageStatus()`; this
path only looks at it. `payload` is never selected, and a test enforces that:
it holds LinkSpy's raw internal status, which must not come within one
`JSON.stringify` of a client's browser.

### The honesty problem this section is really about

Production has three shapes, and one of them must not be rendered:

| Page | Items | Renders |
|---|---|---|
| Fautons LP | 39 · 38 passed · 1 failed | "38 of 39 checks holding · 1 needs attention" |
| 24 Hours AR HubSpot LP | 38 · 21 passed · 17 failed | "21 of 38 checks holding · 17 need attention" |
| 5-Day Metabolic Health | 38 · **all N/A** | **nothing — the section is absent** |

The third is not a bad score. It is an ungraded checklist — QA was tracked at the
verdict level, not per check (CLAUDE.md). "0 checks holding" would state
something false and alarming on that client's certificate, so `buildVerification`
returns `null` and the renderer omits the section entirely.

Two related rules, both tested:

- **The denominator and the failure are always on the same line as the win.**
  "38 checks holding" alone would be a marketing number; "38 of 39 · 1 needs
  attention" is a verification one.
- **"last checked", not "verified".** We know when *we* fetched, not the instant
  LinkSpy verified. Section 1 replaces this with LinkSpy's authoritative `as_of`;
  until then the copy claims only what is true. A null timestamp yields no clause
  at all rather than "just now", and clock skew can never render "in 3 hours".

### Files

| Repo | File | Purpose |
|---|---|---|
| Dashboard | `src/lib/living-certificate/verification-shape.ts` | pure; returns `null` when ungraded |
| Dashboard | `…/verification-shape.test.ts` | 11 tests, the three real shapes |
| Dashboard | `…/[shareId]/route.ts` | two selects added, one shared clock read |
| Shell | `lib/verification.ts` | pure wording + coarse relative time |
| Shell | `lib/verification.test.ts` | 11 tests |
| Shell | `lib/scope.test.ts` | 5 contamination guards |
| Shell | `components/VerificationCounters.tsx` | presentational |
| Shell | `app/live/layout.tsx` | scope door + Geist |
| Shell | `tailwind.config.ts`, `app/globals.css` | the ported tokens |

### Test results

| Suite | Result |
|---|---|
| Dashboard `npm test` | **194 pass, 0 fail** (46 living-certificate) |
| Shell `npm test` | **24 pass, 0 fail** |
| Both `tsc --noEmit` | clean |
| Both `npm run build` | ✅ |
| Runtime scope check | `/live/` light, `/` dark — see §13 |
| **Invariant 1** | `git diff --exit-code origin/main -- src/app/c/ certificate-document.tsx` → **no diff** |

---

## 15. Next: Sections 1 and 2

Both are unstarted. Section 1 is unblocked on palette but now carries a hard
constraint on its data path; Section 2 is still blocked on LinkSpy.

### F10 — the shell must never reach LinkSpy (HARD CONSTRAINT on Section 1)

> Operator, 2026-08-11: *"Section 1 needs a Dashboard-side proxy for the LinkSpy
> chip data so an unauthenticated observer can't infer client health. Compose on
> the Dashboard, expose through endpoint 1's shape, keep the shell fetching only
> from the Dashboard."*

Recorded here as **F10**. (The instruction cited "F16"; this note's findings run
F1–F5 and F7–F9, so the label is new rather than a reference to something
existing. The constraint itself stands.)

§4 already routes all composition through the Dashboard, but for a *key-custody*
reason — the shell is a public repo and may hold no `qab_` key. F10 adds a
second, independent reason that survives even if key custody were solved:
**`/live/{shareId}` is an unauthenticated URL, so anything in its payload is
readable by anyone the link reaches.** The share token is a capability to view
*one page's* certificate, not a credential to observe a client's estate.

Practically, for Section 1:

- The shell keeps making **exactly one** call, to endpoint 1. No LinkSpy origin
  is ever named in shell code. Worth a `scope.test.ts` assertion in the same
  commit — the shell must contain no `qa-bridge`/`registry-bridge` string.
- Endpoint 1 returns **derived chip states only** — `ok` / `attention` /
  `unknown` per check — never LinkSpy's raw payload, never counts that let an
  observer reconstruct the estate.
- F5 still applies: `hrefByChip` holds signed deep links into internal LinkSpy
  and must not enter the payload.

### F11 — client-presence is the wrong granularity for a per-page token

Concrete, and the sharpest instance of F10. `getClientPresenceChips()` is keyed
on `registry_client_id` and, by its own documentation
([client-presence-chips.ts](../../src/lib/linkspy/client-presence-chips.ts)),
aggregates **every site LinkSpy holds under `sites.client_id` — including sites
that never had a Dashboard deliverable.** It is explicitly *"a superset"*.

Piping that through Section 1 means a holder of **one page's** share link learns
the aggregate health of **all of that client's sites**, including properties we
never built. The token is per-page; the data is per-client. That mismatch is
exactly what F10 exists to prevent.

**Recommended resolution:** Section 1 sources from `Page.registrySiteId` — the
page's own site — via `qa-bridge/status`, not from the client-level presence
feed. If a client-level figure is genuinely wanted later (Section 4's uptime and
incident counts are client-level in the original brief), that is a **separate
decision with an operator sign-off**, not a default. Section 4's vitals stay null
until then.

### Section 2 — unchanged, still blocked

`f280398` remains unmerged on LinkSpy `main`, and `LIVING_CERTIFICATE=1` is not
set on Railway. See §2 and the runbook. Option A (whitelisted lifecycle events
only) stands; incidents remain deferred.

### Recommended next session — the smallest useful one

**Section 1, page-scoped, in one sitting.** It is the only remaining work that is
both unblocked and self-contained:

1. `statusReadOnly()` — the F3 sibling to `getPageStatus()`. Reads the
   `LinkSpyStatus` cache row, fetches `qa-bridge/status` on miss, **persists
   nothing**; 60 s in-memory cache, mirroring `client-presence-chips.ts`.
2. A pure `health-shape.ts` that maps the derived catalogue to five chip states,
   with the same null-means-absent discipline as Sections 3 and 4.
3. `live_health` filled in endpoint 1 — an additive fill-in, no shape change.
4. `LiveHealthStrip.tsx` on the shell, using the `lc-*` tokens that now exist.
5. Tests: the F10 assertion above, plus the no-write guard extended to the new
   helper.

It needs no palette decision, no LinkSpy merge, and no schema change. Everything
it touches on the Dashboard is already read by endpoint 1's single query.

**Defer to the session after:** Section 2 (needs the LinkSpy merge first), and
the operator-facing enable toggle.

---

## 16. Section 4 copy — reword to per-site scope (PLANNED, not yet applied)

Operator decision, 2026-08-11: **Option B.** Section 4's uptime and incident
figures become **per-site**, not per-client. F11 killed the client aggregate; this
records what replaces it and how the copy stops implying a scope it does not have.

### Why nothing is broken today

`uptime_pct`, `incidents_handled` and `health` are `null` in every response, and
`storyClauses()` drops null clauses entirely. **No scoped copy renders anywhere
right now.** The misleading reading only becomes possible the moment Section 1
supplies the vitals — so the reword belongs in that same commit, and applying it
early would be a change no test could meaningfully exercise.

### The scope that is actually available

Three different things could be measured, and only the middle one is both useful
and permitted:

| Scope | Source | Verdict |
|---|---|---|
| This page alone | — | Not measured. LinkSpy monitors sites, not pages |
| **The site this page is published on** | `Page.registrySiteId` → `qa-bridge/status` | ✅ **what we ship** |
| Every site the client owns | `registry_client_id` → `client-presence` | ⛔ F11 — a page token must not reveal an estate |

So the honest unit is **the site**, which is neither the page nor the client. The
copy has to say so, because a figure sitting directly under the page's own name
reads as the page's figure.

### Wire fields — rename now, while it is free

| Today | Becomes |
|---|---|
| `uptime_pct` | `site_uptime_pct` |
| `incidents_handled` | `site_incidents_handled` |
| `health` | `site_health` |

Normally T8 forbids reshaping a response. It does not apply here: the endpoint is
**not deployed** (flag unset on every surface), both branches are **unmerged**,
and these three fields have **never been non-null**. This is the last moment the
rename is free, and a field called `uptime_pct` on a page-scoped payload would
mislead every future reader of the contract.

### Copy — before and after

```
BEFORE (would imply the page, or worse the client)
  Fautons LP
  14 days since delivery · 99.8% uptime · 3 incidents handled
  ● Currently healthy

AFTER (states its own scope, once)
  Fautons LP
  14 days since delivery · 99.8% site uptime · 3 site incidents handled
  ● Site currently healthy
  Live figures cover the site this page is published on.
```

Exact strings in `lib/story-clauses.ts` and `components/StoryHeader.tsx`:

| Element | Before | After |
|---|---|---|
| uptime clause | `` `${uptime_pct}% uptime` `` | `` `${site_uptime_pct}% site uptime` `` |
| incidents clause | `` `${n} incident(s) handled` `` | `` `${n} site incident(s) handled` `` |
| health `healthy` | `Currently healthy` | `Site currently healthy` |
| health `attention` | `Needs attention` | `Site needs attention` |
| health `unknown` | `Status unknown` | `Site status unknown` |
| scope line | *(none)* | `Live figures cover the site this page is published on.` |

`14 days since delivery` is **unchanged** — it is page-level, comes from our own
`QACertificate.completedAt`, and is accurate as written.

The qualifier appears on each clause *and* in the scope sentence deliberately.
The sentence alone is missable; the per-clause word alone reads as noise. Together
a client cannot come away thinking the number describes the page they are looking
at, which is the only failure mode that matters here.

### The snapshot test that proves it

`lib/story-clauses.test.ts`, added with the reword:

1. **Golden snapshot** of the full clause list for all three states — no vitals,
   vitals present, vitals partial — asserted against literal expected strings, so
   any future copy edit has to be deliberate.
2. **Scope-honesty assertion:** if any site-scoped clause is present, the scope
   sentence must render. Encoded as: `storyClauses()` returning any string
   matching `/site/` implies `scopeNote()` is non-null.
3. **No client-level vocabulary:** no rendered string may match
   `/\b(all|every|your)\s+(sites?|properties)\b/i` or the word `estate` — the
   language F11 exists to keep out.
4. **Null still vanishes** — the existing rule, re-asserted against the renamed
   fields so the rename cannot quietly reintroduce zeroes.

---

## 17. Section 1 — live health strip (PLANNED, not started)

Five status chips: SSL, uptime, forms, tracking, links. Palette-unblocked (§13);
data path constrained by F10 and F11.

### Wireframe

```
┌────────────────────────────────────────────────────────────┐
│  LIVE HEALTH                                               │
│  ┌────────┬────────┬────────┬──────────┬────────┐          │
│  │  SSL   │ Uptime │ Forms  │ Tracking │ Links  │          │
│  │   ●    │   ●    │   ●    │    ●     │   ●    │          │
│  │ Valid  │  99.8% │   OK   │  Active  │ 2 dead │          │
│  └────────┴────────┴────────┴──────────┴────────┘          │
│  Live figures cover the site this page is published on.    │
└────────────────────────────────────────────────────────────┘
```

Chip state is `ok` / `attention` / `unknown` → `lc-success` / `lc-warning` /
`lc-muted`. A chip whose underlying check is absent renders `unknown`, never a
green tick — same discipline as Sections 3 and 4: absence is never success.

### Fetch plan

```
DASHBOARD  endpoint 1, after the existing single query
  │
  ├─ page.registrySiteId ?  no  → live_health: null, strip hidden
  │
  └─ statusReadOnly(page.id)              ← F3 sibling, NEVER writes
       ├─ read LinkSpyStatus row (cache)  ← a READ; the internal page owns the write
       ├─ miss → GET qa-bridge/status?qa_page_ref=…   4 s timeout
       ├─ 60 s in-memory Map, mirroring client-presence-chips.ts
       └─ failure → last-known-good, then null. Never throws, never 500s.
  │
  └─ buildLiveHealth(payload) → five derived chip states ONLY
```

**No `client-presence` call. No `registry_client_id`. Anywhere.** (F11)

### The five constraints this must satisfy

| # | Constraint | Enforcement |
|---|---|---|
| F3 | `statusReadOnly()` persists nothing | no-write grep extended to the new helper |
| F5 | no `hrefByChip` / `signHandoff` in the payload | existing assertion covers new files |
| F10 | the shell never names a LinkSpy origin | **new**: no `qa-bridge` / `registry-bridge` string anywhere in the shell |
| F11 | no client-level source | **new**: endpoint 1 must not reference `client-presence` or `registryClientId` |
| T8 | `live_health` is an additive fill-in | key already present and null since Section 4 |

### Files

| Repo | File | Status |
|---|---|---|
| Dashboard | `src/lib/linkspy/status-readonly.ts` | new — the F3 sibling |
| Dashboard | `src/lib/living-certificate/health-shape.ts` | new — pure catalogue → five chips |
| Dashboard | `…/health-shape.test.ts` | new |
| Dashboard | `…/[shareId]/route.ts` | fill `live_health` |
| Dashboard | `…/isolation.test.ts` | extend no-write + add F11 assertion |
| Shell | `components/LiveHealthStrip.tsx` | new |
| Shell | `lib/living-certificate.ts` | `LiveHealth` type |
| Shell | `lib/story-clauses.ts`, `components/StoryHeader.tsx` | §16 reword |
| Shell | `lib/scope.test.ts` | add the F10 assertion |

### Order of work

1. `statusReadOnly()` + its no-write test — the riskiest piece, proven first.
2. `health-shape.ts` + tests, pure, against real payload fixtures.
3. Fill `live_health`; extend the isolation tests (F10, F11).
4. §16 reword + snapshot test, in the same commit as the vitals it describes.
5. `LiveHealthStrip.tsx`; verify chips in both the all-ok and degraded states.

Needs no schema change, no LinkSpy merge, and no further palette decision.

---

## 18. Deferred to Session 3+

The operator-facing **enable toggle** (a server action beside `createShareLink` /
`revokeShareLink`), **custom domain**, **analytics**, and **incident cards** in
Section 2 (Option B — revisit if the narrative reads as incomplete in real use).

---

**STOP.** Sections 4 and 3 are built and tested; the palette port is scoped and
verified (§§12–14). §16 (the per-site reword) and §17 (Section 1) are PLANS —
no code has been written for either, pending review. Section 2 remains blocked on
the LinkSpy merge.
