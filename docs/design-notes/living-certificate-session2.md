# Living Certificate — Session 2 diagnosis (Step 0)

**Date:** 2026-08-11 · **Repo:** Dashboard · **Branch:** `feat/living-certificate-timeline-shape`
**Status:** ✅ **All four sections built. Section 2 cannot be verified live yet:
`LIVING_CERTIFICATE` is still unset on Railway and 0 of 265 pages carry a
`registryDeliverableId` (§20). Nothing enabled anywhere.**

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
| Null vitals | **Ship the nulls.** A null clause beats a fabricated number; the wire fields are ready for a real per-site source (§18) |

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

## 16. Section 4 copy — reword to per-site scope (BUILT — see §18)

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

## 17. Section 1 — live health strip (BUILT — see §18)

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

## 18. Section 1 + the reword — what actually landed

Both shipped together, as agreed: the copy is honest from the first byte a client
sees, because the vitals it describes arrive in the same commit.

Dashboard `f7fdf83` · shell `b234c08`.

### Four chip states, not five

`settling` was specified and is **not implemented**. LinkSpy supplies three
verdicts; the one candidate signal — `uptime` arriving with `last_checked: null`
— is a *healthy* check that carries no per-check timestamp, its detail reading
`"Reachable · 99.4% uptime"`. Labelling that "settling" would put a fault on a
client's certificate that no measurement supports.

Adding it needs a real input, e.g. a monitoring-start timestamp from LinkSpy.
Until that exists the state is absent rather than guessed — the same rule that
makes an ungraded checklist render nothing in §14.

Rendered from the one mapped production page:

| Chip | State | Renders |
|---|---|---|
| SSL | `healthy` | green · "Valid" |
| Uptime | `healthy` | green · "Reachable" |
| Forms | `unknown` | grey · "Not checked" |
| Tracking | `unknown` | grey · "Not checked" |
| Links | `attention` | amber · "Broken link found" |

Severity is a **presentation** policy, documented as such: SSL and uptime
failures are `critical` because a visitor is hurt right now; forms, tracking and
links are `attention` because the page still works. An open `incident_ref`
escalates anything. LinkSpy says "failing"; we decide how loudly a client hears it.

### F11 dead weight — what the guard caught

The new F11 assertion failed on first run against the route's own query:

```prisma
client: { select: { name: true, registryClientId: true } }   // ← removed
```

`registryClientId` was selected and never used — left from Section 4's original
client-scoped plan, which F11 had since killed. Harmless while unused, and
exactly the affordance that would let someone wire `client-presence` back in
without noticing they had crossed a boundary. The key now never enters this path
at all; only `client.name` is read.

Two more guards fired and were **narrowed rather than loosened**:

| Guard | Caught | Fix |
|---|---|---|
| `getPageStatus` ban | `getPageStatusReadOnly` by substring | negative lookahead — the ban is on the writer only |
| `payload` ban | a legitimate server-side read handed to a pure deriver | banned as an object KEY (select / response), not as a property read |

Both were my own tests being blunter than the rule they encoded. Neither rule was
weakened.

### The duplicate that only rendering caught

The scope sentence appeared **twice** — once in `StoryHeader`, once in the strip.
`site_health` is derived from the same chips, so the header always states the
scope directly above the strip; saying it again read as a disclaimer rather than
a fact. Removed from the strip. No test would have found this; rendering all four
states side by side did.

### Still null, and staying that way

`site_uptime_pct` and `site_incidents_handled` remain null. `qa-bridge/status`
returns verdicts, not a numeric uptime or an incident count — the uptime figure
exists only inside a human sentence. The one structured source was the
client-level feed, which F11 rules out.

**Operator decision: ship the nulls.** When a real per-site source exists the wire
fields are already in place and the copy already renders them correctly. A null
clause beats a fabricated number.

`site_health` **is** populated, derived from the same chips as the strip, so the
header and the strip can never disagree.

### Verification

| Check | Result |
|---|---|
| Dashboard `npm test` | **215 pass, 0 fail** (67 living-certificate) |
| Shell `npm test` | **32 pass, 0 fail** |
| Both `tsc --noEmit` / `build` | clean |
| F10 guard | ✅ no shell file names `qa-bridge` / `registry-bridge` / `LINKSPY_API_KEY` |
| F11 guard | ✅ no `client-presence`, `getClientPresenceChips`, `registryClientId` |
| No-write guard | ✅ extended to `status-readonly.ts` |
| **Invariant 1** | ✅ `/c/` byte-identical to `origin/main` |
| Flags | unset on all surfaces; **0 of 265** pages opted in |

---

## 19. Section 2 — the plan (BUILT — see §20)

Section 2 is the only unbuilt section, and **nothing about it needs deciding**.
Option A (whitelisted lifecycle events only) was settled in §0; the whitelist
itself already exists and is tested
([timeline-shape.ts](../../src/lib/living-certificate/timeline-shape.ts)); the
payload already carries `timeline: null` as an additive seam.

What remains is **pure operator work, both in the LinkSpy repo**:

| # | Step | Verify |
|---|---|---|
| 1 | Merge `f280398` (*read endpoint for client_timeline*) to LinkSpy `main` and deploy to Railway | `git show origin/main:backend/main.py \| grep 'registry-bridge/timeline'` returns a hit |
| 2 | Set `LIVING_CERTIFICATE=1` on Railway | the endpoint answers `200`, not `404`, for a `qab_` key |

Once both are done, Section 2 is a short session: the Dashboard calls the
endpoint with `Page.registryDeliverableId` (already selected by the query),
whitelists through `toClientTimeline()`, and the shell renders narrative cards
with the `lc-*` tokens that now exist. No schema change, no new decision.

Full activation order and rollback: [runbooks/living-certificate.md](../runbooks/living-certificate.md).

---

## 20. Section 2 — history timeline (BUILT, not yet verifiable end-to-end)

Built on `feat/living-certificate-timeline` in both repos, branched off the
merged mains. The code is complete and tested; **three things prevent a live
end-to-end check**, all recorded below with evidence.

### Step 1 diagnosis — a stated prerequisite is not actually in effect

**The LinkSpy endpoint is deployed, but `LIVING_CERTIFICATE` is NOT set on
Railway.** Probed unauthenticated — no service key is needed to learn this:

```
GET …/api/registry-bridge/timeline?registry_deliverable_id=…&limit=100
→ HTTP 404  {"error":"living_certificate_disabled"}
```

That exact body comes only from the timeline route's own flag gate, which runs
**before** authentication:

```python
if os.getenv("LIVING_CERTIFICATE") != "1":
    return JSONResponse({"error": "living_certificate_disabled"}, status_code=404)
```

So the merge and deploy landed — the route exists and is executing — and the flag
is still off. Had the route been missing entirely, the response would have been a
generic 404 with no such body.

**No page carries a `registryDeliverableId`: 0 of 265.** Even with the flag on,
every page returns `timeline: null` today, because the field the timeline is keyed
on is unset everywhere.

**The Dashboard's local `.env` has no `LINKSPY_API_URL` / `LINKSPY_API_KEY`**, so
no live call could be made from this machine regardless. Vercel may have them;
not verifiable from here.

None of the three blocks the build — the code treats all of them as `null` by
design, which is exactly Invariant 3. They block only the live check.

### null vs [] — the distinction the section rests on

| Value | Means | Renders |
|---|---|---|
| `null` | we did **not** look successfully — no annotation, flag off on LinkSpy, unreachable, unreadable body | **no section at all** |
| `[]` | we **did** look; the ledger is genuinely empty | "Timeline begins after delivery." |
| `[…]` | whitelisted events | cards, newest first |

Collapsing those two would make a failed lookup read as *"nothing has ever
happened to your site"* — something we have no basis for saying. Same rule as an
unmapped page in Section 1 and an ungraded checklist in Section 3, asserted at
three layers: `readLedger`, `serveTimeline`, and a shell grep that the route keys
on `timeline !== null` rather than truthiness (an empty array is falsy-adjacent
in a reviewer's head, and `&&` on `[]` renders nothing).

### A restructure the tests forced

`timeline-fetch.ts` began as one module and could not be unit-tested:
`server-only` is not an installed package — Next resolves it at build time — and
**no test in this repo imports a server-only module directly.**

Rather than drop the import, which is what keeps the service key out of client
bundles, the module was split along the line the repo already uses for
`catalog-map.ts` + `linkspy/client.ts`:

| File | Holds | Tested by |
|---|---|---|
| `timeline-source.ts` | URL building, body reading, null-vs-`[]` policy, cache window, staleness | import — 16 cases |
| `timeline-fetch.ts` | env, `fetch`, a `Map` | grep — `server-only` present, no `db`, key never in the URL |

The shell is now thin enough that everything worth asserting lives in the pure
half.

### Ordering, and why the renderer sorts anyway

**Newest first**, matching Sections 1 and 3, which both lead with current state:
this is a *living* certificate, so what is true now outranks what was true first.

LinkSpy already returns the ledger newest-first and the whitelist preserves that
order, so `orderNewestFirst()` is usually a no-op. It runs regardless because the
section makes a promise about chronology to its reader, and a section should keep
its own promise rather than inherit an upstream ordering it does not control. The
sort is stable, so events sharing a timestamp keep ledger order.

### Copy

Cards are narrative-first: the sentence leads, the detail follows, the date sits
muted underneath. A timestamp-first row would read as machine output, and this is
the one section whose job is to read like a story.

Dates are formatted explicitly in UTC (`28 July 2026`) rather than through
`toLocaleDateString`: the same string must come out of the server and the
browser, or React hydration mismatches and a reader in Sydney sees a different
date from one in London. The format matches `/c/{shareId}`.

The empty state is **"Timeline begins after delivery."** — a fact about the
timeline, not an absence of data. A test asserts the copy never opens with "No…"
and never contains *empty / none / nothing / yet*, because those read as a bug
rather than a state.

### Verification

| Check | Result |
|---|---|
| Dashboard `npm test` | **232 pass, 0 fail** (84 living-certificate) |
| Shell `npm test` | **43 pass, 0 fail** |
| Both `tsc --noEmit` / `build` | clean |
| Rendered — populated | 2 cards, newest first, rail joining them |
| Rendered — empty | "Timeline begins after delivery." |
| Rendered — null | section absent; Sections 1/3/4 unaffected |
| Mobile 390 px | no horizontal overflow |
| F10 | ✅ shell still names no `qa-bridge` / `registry-bridge` |
| F11 | ✅ no `client-presence` / `registryClientId` on the path |
| No writes | ✅ `timeline-fetch.ts` imports no `db` at all |
| **Invariant 1** | ✅ `/c/` byte-identical to `origin/main` |
| Flags | untouched everywhere; **0 of 265** pages opted in |

### A merge note worth keeping

PR #12 was merged one commit early: all Section 1 **code** reached `main`, but the
closing docs commit `63ae844` did not, so §§16–19 were left reading PLANNED on
`main` while the code they described was already there. Cherry-picked onto this
branch rather than rewritten, so the history stays honest.

### To see a timeline live, in order

1. Set `LIVING_CERTIFICATE=1` on **Railway** → the endpoint stops answering 404.
2. Ensure `LINKSPY_API_URL` / `LINKSPY_API_KEY` are set on **Vercel `dashboard`**.
3. Register at least one deliverable, so a page has `registryDeliverableId`.
4. Then activation proper: `LIVING_CERTIFICATE=1` on Vercel `dashboard` and
   `qa-ecosystem`, and opt a page in.

Steps 1–3 are prerequisites for the section having anything to show; step 4 is
activation, and belongs with the enable toggle in Session 5.

---

## 21. Deferred to Session 3+

The operator-facing **enable toggle** (a server action beside `createShareLink` /
`revokeShareLink`), **custom domain**, **analytics**, and **incident cards** in
Section 2 (Option B — revisit if the narrative reads as incomplete in real use).

---

**SESSION COMPLETE.** Sections 1, 3 and 4 are built and tested across both repos,
the Option A palette port is scoped and verified, and the per-site reword shipped
with the vitals it describes (§§12–18). Section 2 remains, blocked only on two
operator steps in the LinkSpy repo (§19) — no design decisions are outstanding.

Nothing is enabled: `LIVING_CERTIFICATE` is unset on every surface, no page has
`livingCertificateEnabled` set, and `/c/{shareId}` is byte-identical to
`origin/main`.
