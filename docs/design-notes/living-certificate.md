# Living Certificate — Step 0 diagnosis

**Date:** 2026-08-10 · **Branch:** `docs/living-certificate-diagnosis` ·
**Status:** ⛔ **STOPPED before code. Two hard blockers and one architectural
conflict. Operator approval required.**

Step 0 was read-only. No code was written, no schema touched, no branch cut for
implementation. This note records what is actually there, which is not quite
what the brief assumes.

---

## 0. Summary — why this stopped

| # | Finding | Severity |
|---|---|---|
| **A** | **A public, no-login, token-URL certificate already exists** (`/c/{shareId}` on the Dashboard, opt-in per page, instantly revocable). The proposed column + table would be a *second* opt-in and a *second* token store for the same concept | **Architectural conflict — approval needed** |
| **B** | **Shell repo (`apexure-shell` / `qa-ecosystem`) is not on this machine.** Step 3 — the entire render surface — cannot be built here | **Blocker** |
| **C** | **T6 fired: no credentials.** No `.env`, `DATABASE_URL` and `SUPABASE_URL` both unset. The T3 dump and the T2 drift check are both impossible, so Step 1 cannot legally start | **Tripwire T6 — STOP** |
| **D** | `client_timeline` **has no read path anywhere** — it is written and never read. The history section cannot "compose existing reads"; it needs a new one | Premise correction |

None of T1, T2, T4, T7, T8 fired — because no code or DDL was written. T3 is
pre-empted by T6.

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

### Three options — operator decides

1. **Extend the existing socket (recommended).** Living Certificate becomes a
   *richer rendering* of an existing `shareId`, not a new grant. Add
   `Page.livingCertificateEnabled` as the **view toggle only** (which renderer
   the token resolves to), reuse `shareId` as the capability, and inherit
   revocation for free. One opt-in, one token, one revoke. Still additive-only:
   one boolean column, **no new table at all**.
2. **New parallel grant** (as briefed). Accept two independent share states and
   mitigate with a reconciliation routine per §9 — more moving parts, and the
   failure mode is silent over-exposure of client data.
3. **Supersede.** Living Certificate replaces `/c/{shareId}`, which redirects.
   Cleanest end state, but it *changes an existing surface* → **violates
   invariant 1 and trips T7**. Not available under this brief.

Option 1 satisfies every stated invariant, removes the split-brain, and *reduces*
the DDL from one column + one table to one column.

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

## 8. What is needed to proceed

1. **Decide Finding A** — Option 1, 2, or 3. This changes the DDL, the endpoint
   set, and the test matrix, so nothing should be built before it is settled.
2. **Credentials for the dump** (T6/T3): `DATABASE_URL` + `DIRECT_URL`
   (Dashboard) and Supabase access (LinkSpy). Without these no migration may be
   applied, and I will not write DDL that cannot be dumped first.
3. **The shell repo**, or a decision to defer Step 3.
4. **Confirm the auth model** is stored-token, not HMAC-signed (§6).

Steps 1–4 of the brief remain unstarted, by design. No implementation branch has
been cut.
