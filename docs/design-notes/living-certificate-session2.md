# Living Certificate — Session 2 diagnosis (Step 0)

**Date:** 2026-08-11 · **Repo:** Dashboard · **Branch:** `feat/living-certificate-timeline-shape`
**Status:** ⛔ **Stopped for review. No UI code written. Two items need an operator decision before Step 1.**

Session 1 shipped `Page.livingCertificateEnabled` (boolean, default false, applied
to production, 265 rows backfilled, drift-free — commit `bd30dd0`). This note is
the read-only diagnosis for Session 2's rendering work.

---

## 0. Summary — six findings

| # | Finding | Severity |
|---|---|---|
| **F1** | **The brief contradicts the approved architecture.** §9.1 of `living-certificate.md` says `/c/{shareId}` is *"BYTE-IDENTICAL, untouched forever"* and puts the Living Certificate on a **separate `/live/{shareId}` route on the shell repo**. This brief puts it **inside `/c/{shareId}` on the Dashboard** — which §3 records as *"which the brief explicitly forbids"* | ⛔ **Decision required** |
| **F2** | **The timeline endpoint is not merged to LinkSpy `main`.** Section 2 has no data source in production | ⛔ **Blocker** |
| **F3** | **Reusing `getPageStatus()` writes to an existing table** (`LinkSpyStatus` upsert), violating Invariant 3 — and would let anonymous public traffic trigger DB writes | ⚠️ **T4 tripwire** |
| **F4** | **"Byte-identical snapshot" is not achievable as literally specified** — the current renderer reads the wall clock, so its output changes daily regardless of this feature | ⚠️ Test design |
| **F5** | `getClientPresenceChips()` returns **signed handoff deep-links into internal LinkSpy**. These must never reach a client's browser | ⚠️ Leak risk |
| **F6** | Three of four sections need new fetches; only Section 3 is substantially reusable from data the current view already has | ℹ️ Scope |

---

## 1. The current `/c/{shareId}` renderer

**Route:** [src/app/c/[shareId]/page.tsx](../../src/app/c/[shareId]/page.tsx) — 62 lines.
The only unauthenticated route in the app (outside `/dashboard/*`, so `src/proxy.ts`
does not gate it). `robots: { index: false, follow: false }`.

### Structure

```
PublicCertificatePage (server component, async)
  └── db.page.findUnique({ where: { shareId } })   ← ONE query, the whole data layer
        └── notFound() when the token does not resolve
  └── <main class="min-h-screen bg-page px-4 py-8">
        └── <div class="mx-auto max-w-3xl">
              ├── <PrintButton/>                    (print:hidden)
              ├── <TiltCard>                        (motion wrapper)
              │     └── <CertificateDocument page={page}/>
              └── <p>Quality assurance certificate · Apexure</p>
```

### What the single query fetches

| Included | Fields |
|---|---|
| `page` | `id`, `name`, `url`, `deliveryMonth`, `delayDays` |
| `project` | `name`, `type`, `platform` |
| `project.client` | `name` |
| `developer`, `tester` | `name` |
| `certificate` | `status`, `completedAt` |
| `certificate.items[]` | `category`, `name`, `result`, `valueDesktop`, `valueMobile`, `isMeasurement`, `hasDualValue` — ordered by `order asc` |
| `issues[]` | `severity`, `status` |

**Not fetched today:** `registryDeliverableId`, `registrySiteId` (on `Page`),
`client.registryClientId`. All three are needed to address LinkSpy. They are
columns on rows already being read — adding them to the existing `include` costs
no extra round trip.

### What `CertificateDocument` renders

[src/components/qa/certificate-document.tsx](../../src/components/qa/certificate-document.tsx) — 383 lines,
an `async` server component shared byte-for-byte with the internal page detail
view. Composition, in order:

1. **Header** — `Logo`, "Quality Assurance Certificate", reference `page.id.slice(-8)`
2. **Title block** — page name, `client · project`, live URL link, verdict pill (`PASS`/`FAIL`/`IN_PROGRESS`)
3. **Plain-language summary** sentence
4. **`SitePreview`** — screenshot of the live page (when `page.url`)
5. **Field grid** — Platform, Type, Delivery, Developer (`Avatar`), Tester (`Avatar`), Delay
6. **QA checklist** — grouped by category, `ResultCell` per item, with `N checks · N passed · N failed · N N/A`
7. **Issues** — resolved/total + severity dots
8. **Footer** — "Verified by …", signed-off/issued date, `HolographicSeal` (PASS only), inline QR to the live page
9. **Contact strip** — success@apexure.com · apexure.com

Derived in-component (relevant to Section 3): `passed`, `failed`, `na`,
`items.length`, `categories`, `totalIssues`, `resolved`, `bySeverity`.

---

## 2. F2 — the timeline endpoint is not merged (BLOCKER)

```
origin/main .. origin/feat/living-certificate-timeline-read
  f280398  feat(living-certificate): read endpoint for client_timeline
```

- `git branch -r --merged origin/main` → **does not list the branch**
- `origin/main:backend/main.py` → `/api/registry-bridge/timeline` **absent**
- `origin/main:backend/database.py` → `timeline_add` present, **`timeline_for_deliverable` absent**

The endpoint itself (read on the feature branch) is well-formed for our purposes:
service-key auth, `LIVING_CERTIFICATE=1` gated (404 when off), rate-limited,
`limit` clamped to 200 rather than rejected, `SELECT`-only, and it returns
`{registry_deliverable_id, as_of, limit, truncated, count, events[]}`. An empty
history returns `count: 0`, not a 404 — correct for a freshly signed-off page.

Its docstring is explicit that it is **not** a client surface: `payload` is
returned **raw** and may carry internal ids. Whitelisting is the Dashboard's job —
which Session 1 already built (§5 below).

**Section 2 cannot reach production until:** (a) `f280398` is merged to LinkSpy
`main` and deployed to Railway, and (b) `LIVING_CERTIFICATE=1` is set on Railway.
That is a separate PR in the other repo. Sections 1, 3 and 4 do not depend on it.

---

## 3. F1 — the architecture conflict (DECISION REQUIRED)

The approved note says:

> ```
> Page.shareId (existing, unique, nullable)   ← THE capability.
>    ├── /c/{shareId}      existing static certificate — BYTE-IDENTICAL, untouched forever
>    └── /live/{shareId}   living certificate (Session 2, on the shell)
> ```
> — §9.1

and §3 lists "place the route on the Dashboard instead" as the option *"the brief
explicitly forbids"*.

This session's brief reverses both: same URL, Dashboard repo, conditional render.

**This is the operator's call to make, and the brief is the newer instruction, so
I have planned against the brief.** It needs recording because three parts of the
approved note become obsolete:

| §9 element | Under the brief |
|---|---|
| `/live/{shareId}` on the shell | **Dropped.** No shell involvement; the shell repo is still not on this machine |
| Endpoint 1, `GET /api/living-certificate/{shareId}` | **Unnecessary.** The `/c/` server component composes in-process; no new public API surface exists to secure |
| §9.5 flag on Vercel `qa-ecosystem` | **Not needed.** Flag goes on Vercel `dashboard` + Railway only |

Worth noting the brief's shape is **simpler** than the approved one — it deletes a
public route, a repo, and a service-key hop. The cost is that `/c/{shareId}` is no
longer "untouched forever"; it gains a branch. Invariant 1 is what holds the line
instead, and §6 below is how that gets proven.

---

## 4. F6 — data inventory: reuse vs new fetches

| Section | Field | Source | New fetch? |
|---|---|---|---|
| **1. Live health** | SSL, uptime, forms, tracking, links | `/api/qa-bridge/status` | 🆕 yes |
| | incidents, fragility | `/api/registry-bridge/client-presence` | 🆕 yes |
| **2. Timeline** | narrative events | `/api/registry-bridge/timeline` | 🆕 yes (**blocked, F2**) |
| **3. Counters** | "38 checks holding" | `certificate.items[]` — **already fetched**, already counted at `certificate-document.tsx:100-102` | ♻️ **reuse** |
| | "verified 4 hours ago" | `as_of` from `/api/qa-bridge/status` | 🆕 yes |
| **4. Story mode** | days since delivery | `certificate.completedAt` — **already fetched** | ♻️ **reuse** |
| | page name, client name | **already fetched** | ♻️ **reuse** |
| | uptime %, incidents handled | `/api/registry-bridge/client-presence` | 🆕 yes |
| | "currently healthy" | `/api/qa-bridge/status` | 🆕 yes |

**Net: three distinct LinkSpy endpoints, all already-existing helpers except the
timeline.** The brief's claim that Section 3 "data already exists in the current
/c view" is right for the counts and wrong for the freshness — `as_of` has never
been on this page.

### Existing helpers on the Dashboard

| Helper | Endpoint | Cache | Writes? |
|---|---|---|---|
| [`getPageStatus()`](../../src/lib/linkspy/client.ts) | `qa-bridge/status` | 15 min, **in `LinkSpyStatus` DB row** | ⚠️ **YES — upserts** |
| [`getClientPresenceChips()`](../../src/lib/linkspy/client-presence-chips.ts) | `registry-bridge/client-presence` | 60 s, in-memory `Map` | ✅ no |
| [`toClientTimeline()`](../../src/lib/living-certificate/timeline-shape.ts) | *(pure — no I/O)* | — | ✅ no |

---

## 5. Session 1 already built the timeline whitelist

[src/lib/living-certificate/timeline-shape.ts](../../src/lib/living-certificate/timeline-shape.ts)
is present on this branch with tests. It is the deny-by-default boundary that
turns LinkSpy's raw ledger rows into client-safe events: unknown `type` dropped
entirely, `payload` never spread, no ids ever emitted, malformed/undated rows
dropped. Currently allows two kinds — `handed_to_qa`, `signed_off`.

Section 2 must render **only** `ClientTimelineEvent`, never `LedgerEvent`.

⚠️ **Gap to note:** the brief's example card is *"Feb 12: SSL expired. Detected in
4 min. Resolved in 11 min."* — an **incident**. The whitelist has no incident
rule, and incidents live in `sentinel_incidents` (via client-presence), not in
`client_timeline`. Section 2 as briefed therefore needs either a new whitelist
rule or a merge of two sources. **This is scope growth beyond "renders the
timeline endpoint" — flagging rather than assuming.** See §9.

---

## 6. F3 + F4 — the two things that make the invariants harder than they look

### F3 — `getPageStatus()` writes (Invariant 3 violation)

```ts
// src/lib/linkspy/client.ts:62
await db.linkSpyStatus.upsert({ where: { pageId: qaPageRef }, … })
```

`LinkSpyStatus` is an **existing table**. Invariant 3 says no writes to any
existing table. Reusing this helper on `/c/{shareId}` would also mean an
**anonymous, unauthenticated visitor triggers a DB write plus an outbound
LinkSpy fetch** on every cache miss — a mild abuse vector on a public URL.

**Proposed:** a read-only sibling that reads the `LinkSpyStatus` cache row and
fetches on miss **without persisting** — in-memory 60 s cache only, following the
`client-presence-chips.ts` precedent exactly. The internal page keeps writing;
the public path never does. Needs your nod since it means a second code path
against the same endpoint.

### F4 — "byte-identical" is not literally testable

```ts
// certificate-document.tsx:113
const issued = new Date().toLocaleDateString("en-GB", {…});
```

The footer renders `Issued 11 August 2026` when `completedAt` is null. **The
current view's bytes already change every day, with or without this feature.** A
stored golden-file snapshot would go red at midnight for reasons unrelated to us.

**Proposed test shape — stronger than a golden file:** render the route twice in
the same test run, once with the flag off and once with the feature branch
disabled, and assert the two outputs are **identical to each other**. That proves
the claim that actually matters — *the flag-off path executes the same code and
produces the same bytes* — instead of proving the page never changes, which is
false. Recommend one frozen-clock unit snapshot alongside it for regression
sensitivity.

### F5 — do not leak handoff links

`getClientPresenceChips()` returns `{presence, hrefByChip}` where `hrefByChip`
holds HMAC-signed deep links into internal LinkSpy (`/handoff?token=…`).
**Public rendering must destructure `presence` only.** A grep test should enforce
that `hrefByChip` never appears under `src/app/c/`.

---

## 7. Layout wireframe

Flag on **and** `livingCertificateEnabled = true`. Everything below the rule is
today's document, unchanged and in the same order.

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
│    (counts ♻️ from certificate.items; freshness 🆕 from as_of)  │
├────────────────────────────────────────────────────────────────┤
│  ▸ SECTION 2 — HISTORY TIMELINE        (blocked on F2)         │
│    ┌──────────────────────────────────────────────┐            │
│    │ 12 Feb 2026                                  │            │
│    │ Quality assurance signed off                 │            │
│    │ 38 checks passed                             │            │
│    ├──────────────────────────────────────────────┤            │
│    │ 08 Feb 2026                                  │            │
│    │ Handed to quality assurance                  │            │
│    └──────────────────────────────────────────────┘            │
│    narrative-first cards, newest first, whitelisted only       │
╞════════════════════════════════════════════════════════════════╡
│                                                                │
│         ↓↓  EXISTING CERTIFICATE — UNCHANGED  ↓↓               │
│                                                                │
│  <TiltCard><CertificateDocument/></TiltCard>                   │
│    header · title+verdict · summary · SitePreview · fields     │
│    · QA checklist · issues · footer+seal+QR · contact strip    │
└────────────────────────────────────────────────────────────────┘
```

Rationale for order: the four new sections sit **above** the existing document so
the current component tree is never re-parented. Nothing is inserted into,
removed from, or reordered within `CertificateDocument` — which is what keeps
Invariant 1 and T7 cheap to prove.

---

## 8. Fetch plan

```
1. DB   db.page.findUnique({ where: { shareId } })        ← EXISTING query,
        + registryDeliverableId, registrySiteId,            3 columns added,
        + project.client.registryClientId                   same round trip
        └── notFound() if unresolved                       (unchanged)

2. GATE livingCertificateEnabled && LIVING_CERTIFICATE=1
        └── false → return today's JSX, untouched. No fetch is issued.

3. NET  Promise.allSettled([                              ← parallel; no
          statusReadOnly(page.id),          // §6 F3        interdependencies
          presence(client.registryClientId),
          timeline(page.registryDeliverableId),
        ])
        60 s in-memory cache · 4 s timeout · staleness over errors
        each rejection hides ONLY its own section
```

**Parallel, not sequential** — all three are keyed off values already present on
the page row after step 1, so none waits on another. Cache 60 s per the brief,
matching the `client-presence-chips.ts` precedent. Every failure degrades to
last-known-good, then to a hidden section; no failure may 500 the page or affect
the existing document below.

---

## 9. What I am NOT assuming (scope questions for you)

1. **F1 — confirm the reversal.** The brief overrides §9.1/§3 of the approved
   note. Confirm and I will treat the approved note as superseded on this point.
2. **F3 — approve the read-only status path**, or accept the `LinkSpyStatus`
   write on the public route (which contradicts Invariant 3).
3. **§5 — incident cards.** The brief's example timeline card is an incident, but
   incidents are not in `client_timeline` and not in the whitelist. Options: (a)
   Section 2 renders only the two whitelisted lifecycle events for now, (b) add an
   incident rule and merge the client-presence incident feed. **(a) is Session 2;
   (b) is scope growth** — per the brief's "if scope needs to grow, stop and
   design-note", I am stopping here rather than choosing.
4. **F4 — approve the two-render equality test** in place of a golden-file
   snapshot.

---

## 10. Tripwire status

| Tripwire | Status |
|---|---|
| **T1** non-additive DDL | ✅ none — no DDL at all this session |
| **T4** unattended writes to existing rows | ⚠️ **would fire** if `getPageStatus()` is reused as-is (F3). Mitigation proposed |
| **T5** exit test fails after one fix | — not reached |
| **T7** changes existing UI beyond additive rendering | ✅ prevented by design — new sections sit above, `CertificateDocument` untouched |
| **T8** changes existing endpoint response shapes | ✅ none — all three LinkSpy endpoints consumed as-is |

---

## 11. State tests — when off / when on

| # | `LIVING_CERTIFICATE` | `livingCertificateEnabled` | Expected |
|---|---|---|---|
| 1 | unset | `false` | Today's view, byte-identical. Column never read |
| 2 | unset | `true` | Today's view, byte-identical. **Flag off ⇒ column ignored entirely** (Invariant 2) |
| 3 | `1` | `false` | Today's view, byte-identical. No LinkSpy fetch issued |
| 4 | `1` | `true` | Four sections above the unchanged document |
| 5 | `1` | `true`, LinkSpy unreachable | Sections degrade individually; existing document unaffected; no 500 |
| 6 | `1` | `true`, timeline 404 (Railway flag off) | Sections 1/3/4 render; Section 2 hidden; no error |
| 7 | any | `shareId` revoked | `notFound()` — unchanged, inherited revocation |

Plus, in all seven: **zero writes** to `Page`, `QACheckItem`, `QACertificate`,
`Issue`, `LinkSpyStatus`, or any tester-owned record — grep-enforced on the
pattern already passing in `prefill-provenance.test.ts` and `isolation.test.ts`.

---

## 12. Deferred to Session 3+

Not built here, per the brief: the operator-facing **enable toggle** (a server
action beside `createShareLink`/`revokeShareLink`), **custom domain**, and
**analytics**. Also deferred: the shell repo's `/live/` route, now obsolete under
F1 unless the operator reinstates it.

---

**STOP.** Awaiting review of the four questions in §9 before any UI code.
