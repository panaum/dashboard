# Living Certificate — diagnosis + approved architecture

**Date:** 2026-08-10 · **Branch:** `docs/living-certificate-diagnosis` ·
**Status:** ✅ **Architecture approved (Option 1). Blocked on DB credentials for
the T3 dump before Step 1 may begin.**

Step 0 was read-only. §§0–7 record what is actually there, which is not quite
what the brief assumed. **§9 is the approved architecture and is the part to
build from.**

### Operator decisions, 2026-08-10

| Decision | Chosen |
|---|---|
| Share model | **Option 1** — a richer *rendering* of the existing `/c/{shareId}` capability. No new token, **no new table** |
| Auth | **Stored-token**, inherited from `Page.shareId`. Instant revocation, no HMAC |
| Shell rendering (Step 3) | **Deferred to Session 2** — shell repo not on this machine |
| `client_timeline` read endpoint | **Approved as necessary work**, accepted as unestimated |

Session scope: one column, four read endpoints (three existing, one new), the
test suite. No rendering.

---

## 0. Summary — the four findings and how each was resolved

| # | Finding | Resolution |
|---|---|---|
| **A** | **A public, no-login, token-URL certificate already exists** (`/c/{shareId}`, opt-in per page, instantly revocable). A second opt-in + second token store would be §9 split-brain at the client-facing boundary | ✅ **Option 1** — reuse `shareId` as the one capability; the new boolean only selects a rendering. No new table (§9.1) |
| **B** | **Shell repo is not on this machine** — Step 3's render surface has no home here | ⏭ **Deferred to Session 2.** This session ships data only |
| **C** | **T6: no credentials.** `DATABASE_URL` / `SUPABASE_URL` unset, so the T3 dump and T2 drift check are impossible | ⛔ **STILL BLOCKING.** Operator supplying credentials; nothing in §9 may be built until the DB is reachable (§8) |
| **D** | `client_timeline` is **written and never read** — no helper, no endpoint | ✅ Accepted as necessary, unestimated work: one new read endpoint (§9.3 #4) |

**Tripwires:** T6 fired and remains open. None of T1, T2, T4, T5, T7, T8 fired —
no code, no DDL, no UI and no endpoint has been touched. T3 is pre-empted by T6
and will be honoured in order once credentials land.

---

## 1. What the four sections need, and whether it is readable today

| Section | Data | Home | Read path today |
|---|---|---|---|
| **Live health** — SSL, uptime, forms, tracking, links | `sentinel_status`, `uptime_pings`, `sentinel_incidents`; scan findings | LinkSpy | ✅ `GET /api/qa-bridge/status` (service key, keyed on `qa_page_ref`) returns the derived check catalogue. `GET /api/registry-bridge/client-presence` returns SSL/sentinel/incidents/fragility per client. Both service-key authed, both read-only |
| **History timeline** — every incident + resolution | `sentinel_incidents` | LinkSpy | ✅ `list_incidents(site_id)` — but agency-authed only (`_sentinel_payload` sits behind `require_site_access`) |
| **History timeline** — narrative events | `client_timeline` | LinkSpy | ❌ **No read path exists.** One `insert` at `database.py:3288`; no helper, no endpoint, no consumer. See §4 |
| **Continuous verification counters** | derived check catalogue + `as_of` | LinkSpy | ✅ `/api/qa-bridge/status` → `summarize(checks)` already returns holding/failing counts and a timestamp |
| **Story mode** — days since delivery, uptime %, incident count | `signed_off_at` (Dashboard), `uptime_pct`, incidents | both | ✅ `GET /api/registry-bridge/delivery` returns `signed_off_at`; `summarize_sentinel` returns `uptime_pct`; incidents as above |

**Verdict:** three of four sections compose from existing service-key reads. The
timeline does not.

---

## 2. Finding A — the surface already exists

`/c/{shareId}` on the Dashboard is a **public, unauthenticated, opt-in,
per-page, instantly revocable certificate**, live today:

| Mechanism | Where |
|---|---|
| Token column | `Page.shareId String? @unique` — *"public certificate link token (opt-in)"* (`schema.prisma:53`) |
| Mint | `randomBytes(12).toString("base64url")`, generated on demand (`…/[pageId]/actions.ts:155-157`) |
| Revoke | `db.page.update({ data: { shareId: null } })` — **instant** (`actions.ts:165`) |
| Render | `src/app/c/[shareId]/page.tsx` — no login, `robots: { index: false }` |
| Also live | `Client.portalId` → `/portal/{portalId}`, the client portal |

The brief proposes `Page.livingCertificateEnabled` (a second opt-in boolean)
plus `living_certificate_shares` (a second token store) for the same question:
*is this page shared with the client, and under what token?*

That is **§9 failure mode #1 — split-brain drift, "the two disagree and nothing
errors"** — placed at the client-facing boundary, which is the worst possible
location for it. Concretely: revoke `shareId` and the Living Certificate keeps
serving; revoke the living-certificate token and `/c/{shareId}` keeps serving.
Nothing throws. A client keeps seeing data after someone believes they cut
access.

There are already **five** token/capability mechanisms in the platform:
`Page.shareId`, `Client.portalId`, LinkSpy `share_tokens` (scans, migration
008), `attestations` (018), `invites` (007), plus HMAC handoff tokens. A sixth
needs to justify itself.

### Resolution — Option 1 (approved)

Living Certificate becomes a **richer rendering of the token that already
exists**, not a second grant. `Page.shareId` stays the one capability; the new
boolean only says *which renderings that token may resolve to*. One opt-in, one
token, one revoke — and the DDL shrinks to a single column with **no new table
at all**. Full architecture in §9.

---

## 3. Finding B — the render surface has no home here

Step 3 puts `/live/{share_token}` on the shell (`qa-ecosystem` /
`apexure-shell`, per INFRASTRUCTURE.md's topology: a third Vercel project).
**That repository is not on this machine** — no clone under `~`, nothing
matching `*shell*`. The render surface cannot be built, tested, or snapshotted
from here.

Options: clone it and re-scope; or build Steps 1–2 (data) now and Step 3 in a
session with the shell present; or place the route on the Dashboard instead —
which the brief explicitly forbids.

---

## 4. Finding D — `client_timeline` is write-only

```
backend/database.py:3288   client.table("client_timeline").insert(…)   ← the only reference
```

No read helper, no endpoint, no consumer anywhere in either repo. The narrative
history section therefore **cannot** be assembled from existing reads; it needs
a new read path (a `timeline_for_deliverable()` helper plus exposure through the
new endpoint).

This does not violate the read-only posture — a new *read* is still a read — but
it contradicts the brief's "NO new data computation — this endpoint composes
existing reads", and it is work the estimate should carry.

Note also that `client_timeline` is an **append-only ledger** (§8.2). It has
been recording since Phase 2, so there is real history to render — which is
exactly why "start recording NOW, render later" was the right call.

---

## 5. The additive column — insertion point and cascade risk

```prisma
model Page {
  …
  shareId                  String?  @unique  // existing precedent
  livingCertificateEnabled Boolean  @default(false)   // ← proposed
  …
}
```

**Cascade risk: none.** `Page`'s relations are `project` (cascade *in*),
`developer`/`tester` (`SetNull`), and the owned `issues` / `certificate` /
`linkspyStatus`. A defaulted scalar boolean participates in no relation, no
index, and no unique constraint. `shareId` is the precedent: a nullable column
added to this exact model for this exact purpose.

Reversal is `ALTER TABLE "Page" DROP COLUMN "livingCertificateEnabled"` with no
dependent objects.

---

## 6. Auth model — a correction that matters

The brief says "signed URLs" and separately requires "**revocation instant**"
(Step 4.5). **Those two are incompatible.** An HMAC-signed token is valid until
it expires; you cannot revoke one without a denylist — which is a stored table,
i.e. the stored-token model wearing a disguise.

The platform already has both patterns, used correctly:

| Pattern | Used for | Revocable |
|---|---|---|
| **Stored capability token** — random id on a row (`Page.shareId`, `share_tokens`, `attestations`) | long-lived public links | ✅ instantly, by nulling/marking the row |
| **HMAC signed, ≤300s TTL** (`handoff-contract.ts`) | cross-app deep links | ❌ not before expiry — which is why the TTL is 5 minutes |

**A client-facing certificate must use the stored-token model**, exactly as
`/c/{shareId}` already does. Recommend dropping "signed" from the spec to avoid
building a signed token that cannot honour its own revocation test.

---

## 7. T4 audit — every write path in the proposed new code

Under **Option 1** (recommended):

| # | Write | Target | Existing table? |
|---|---|---|---|
| 1 | `db.page.update({ livingCertificateEnabled })` | the one new column | Existing row, **new column only** |
| 2 | — | — | *(no new table; `shareId` already mints/revokes via the existing action)* |

Under **Option 2** (as briefed):

| # | Write | Target | Existing table? |
|---|---|---|---|
| 1 | `db.page.update({ livingCertificateEnabled })` | new column | Existing row, new column only |
| 2 | `INSERT INTO living_certificate_shares` | new table | No |
| 3 | `UPDATE living_certificate_shares SET revoked_at` | new table | No |

**Under either option, zero writes touch `QACheckItem`, `ChecklistTemplateItem`,
`QACertificate`, `Issue`, or any tester-owned record.** The read endpoint is
`SELECT`-only end to end.

This is grep-enforceable on the same pattern already passing in both repos —
`presence.test.ts` and `test_presence.py` assert exactly this shape today, and
the Dashboard already has a standing T4 test (`prefill-provenance.test.ts`:
*"no API route touches the human QACheckItem table"*).

---

## 8. Blocking gate — T3/T6

**Nothing in §9 may be built until the database is reachable.** T3 requires a
verified dump before any migration; T6 fired because `DATABASE_URL` /
`DIRECT_URL` (Dashboard) and Supabase access (LinkSpy) are all unset here.

Order, strictly: operator supplies credentials → I confirm reachability → dump
taken and filename recorded → `prisma migrate diff` shows an empty drift →
migration applied. A failure at any point stops the session.

---

## 9. Approved architecture (Option 1)

### 9.1 The share model

One capability, two renderings. `Page.shareId` is unchanged and remains the only
token; the new boolean says only *which renderings it may resolve to*.

```
Page.shareId (existing, unique, nullable)   ← THE capability. Mint/revoke unchanged.
   │
   ├── /c/{shareId}      existing static certificate — BYTE-IDENTICAL, untouched forever
   └── /live/{shareId}   living certificate (Session 2, on the shell)
                         resolves ONLY when Page.livingCertificateEnabled = true
```

Two levels of control, both already familiar to the operator:

| Action | Effect on `/c/` | Effect on `/live/` |
|---|---|---|
| `revokeShareLink()` (existing, nulls `shareId`) | dead instantly | dead instantly |
| `livingCertificateEnabled = false` | unaffected | dead instantly |
| `LIVING_CERTIFICATE` unset | unaffected | 404 — as if it never existed |

Revocation is inherited, so there is no second thing to remember to revoke. That
was the whole point of Option 1.

### 9.2 Schema — the entire DDL for this feature

```prisma
model Page {
  shareId                  String?  @unique          // existing
  livingCertificateEnabled Boolean  @default(false)  // NEW — the only change
}
```

One additive, defaulted, non-null column on one table. **No new table.** No
index, no constraint, no relation. Reverses with a bare `DROP COLUMN`.

### 9.3 Endpoints

Composition happens on the **Dashboard**, because the Dashboard owns the token.
The shell therefore holds no service keys and makes exactly one call — which is
also why Session 2 is small.

| # | App | Endpoint | Auth | Status |
|---|---|---|---|---|
| 1 | Dashboard | `GET /api/living-certificate/{shareId}` | **the token itself** — no login | **new** |
| 2 | LinkSpy | `GET /api/qa-bridge/status?qa_page_ref=` | `qab_` service key | existing, unchanged |
| 3 | LinkSpy | `GET /api/registry-bridge/client-presence?registry_client_id=` | `qab_` service key | existing, unchanged |
| 4 | LinkSpy | `GET /api/registry-bridge/timeline?registry_deliverable_id=` | `qab_` service key | **new** (§4) |

Endpoint 1 validates `shareId` → `livingCertificateEnabled` → composes 2–4
server-side → returns the four sections in one payload. Its own `LINKSPY_API_KEY`
never leaves the server, exactly as `client-presence-chips.ts` already does.

`GET /api/registry-bridge/timeline` reads `client_timeline`
(`id, registry_site_id, registry_deliverable_id, type, payload, occurred_at,
source`) ordered `occurred_at desc`, via a new `timeline_for_deliverable()`
helper. Append-only ledger, `SELECT`-only, flag-gated, capped and paginated.

**Enabling** is a server action next to the existing `createShareLink` /
`revokeShareLink` in the same file — not a `POST` route — because that is the
established pattern for Dashboard mutations and it inherits the session guard
for free. The brief's `POST /api/living-certificate/enable` is dropped: under
Option 1 there is no token to create, only a boolean to flip.

### 9.4 The four sections, and where each field comes from

| Section | Fields | Source |
|---|---|---|
| **Live health** | SSL, uptime, forms, tracking, links | endpoint 2 (`derive_checks` → `summarize`) |
| **History timeline** | incidents + resolutions, narrative events | endpoint 4, plus incidents via endpoint 3 |
| **Continuous verification** | "38 checks holding, verified 4 hours ago" | endpoint 2 (`summary.holding`, `as_of`) |
| **Story mode** | days since delivery, uptime %, incidents handled, current state | `signed_off_at` (local DB) + endpoints 2–3 |

Nothing here derives new intelligence. Every number is already computed by the
module that owns it; this feature only arranges them.

### 9.5 Flag behaviour

`LIVING_CERTIFICATE=1` on **Vercel `dashboard`** (endpoint 1 + the enable
action) and **Railway** (endpoint 4). Off on either surface ⇒ that surface's
endpoint answers `404`, the enable toggle does not render, and every existing
page is byte-identical. Session 2 adds the same flag to Vercel `qa-ecosystem`.

### 9.6 T4 audit — final, for the approved design

| # | Write | Target | Touches an existing table? |
|---|---|---|---|
| 1 | `db.page.update({ livingCertificateEnabled })` | `Page`, **new column only** | Existing row, new column |

**That is the complete list.** One write, one column. No new table exists to
write to. `shareId` mint/revoke is the *existing* action, unchanged by this work.
Endpoints 1–4 are `SELECT`-only end to end.

Zero writes to `QACheckItem`, `ChecklistTemplateItem`, `QACertificate`, `Issue`,
or any tester-owned record — grep-enforced on the pattern already passing in
both repos.

### 9.7 Rollback

1. Unset `LIVING_CERTIFICATE` on both surfaces → `/live/` 404s, toggle vanishes,
   everything else unchanged. **No data touched.**
2. If reverting the schema: `ALTER TABLE "Page" DROP COLUMN
   "livingCertificateEnabled"`. No dependent objects, no cascade, and
   `/c/{shareId}` is unaffected because it never read the column.

There is no third step, because there is no new table and no new token.

---

## 10. What is needed to proceed

1. **Decide Finding A** — Option 1, 2, or 3. This changes the DDL, the endpoint
   set, and the test matrix, so nothing should be built before it is settled.
2. **Credentials for the dump** (T6/T3): `DATABASE_URL` + `DIRECT_URL`
   (Dashboard) and Supabase access (LinkSpy). Without these no migration may be
   applied, and I will not write DDL that cannot be dumped first.
3. **The shell repo**, or a decision to defer Step 3.
4. **Confirm the auth model** is stored-token, not HMAC-signed (§6).

Item 1 is settled (§9). Item 3 is deferred to Session 2. Item 4 is settled
(stored-token). **Only item 2 — credentials — still blocks.**

No implementation branch has been cut.
