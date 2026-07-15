# ADR-002 — "Run AI QA": what it does today, and how Phase 3 should treat it

**Status:** proposed (Gate 0A diagnosis — read-only; nothing was executed)
**Date:** 2026-07-15
**Related:** ARCHITECTURE.md v7 §3 (note: "absorb or coexist"), §4 (auto-fill), §10 (closing certificate), Constitution ("machine writes must NEVER land unattended in the human checklist table")

---

## 1. Exact code path

**Button →** `AiQaButton` (`src/components/qa/ai-qa.tsx`) opens a dialog (`Flow`).

**Analyse (read-only) →** `analyzeUrl(url)` server action
(`.../[pageId]/actions.ts:141`) → `runQaAgent(url)` (`src/lib/ai/qa-agent.ts:231`):
1. `gatherSignals(url)` (`qa-agent.ts:37`) — **fetches the live URL** (`fetch`,
   12 s timeout, UA `ApexureQA/1.0`), parses HTML (`node-html-parser`), and
   derives ~12 **deterministic** checks (HTTPS/SSL, load time, page size,
   favicon, SEO title+desc, OG tags, H1, GA, Google Ads, Meta Pixel, copyright
   year) + a HEAD request to `/sitemap.xml`.
2. `runJudgment(text, url)` (`qa-agent.ts:183`) — **only if `ANTHROPIC_API_KEY`
   is set** (`getAnthropic()`), calls **Claude** (`QA_MODEL = "claude-opus-4-8"`,
   `client.messages.parse` with a Zod output schema) to judge 4 subjective items
   — "Spell Checked", "All CTA buttons work", "Privacy Page Added", "SEO Title
   and description added" — and suggest issues. No key → returns null; the UI
   shows "Deterministic checks only (no API key)". Graceful either way.
3. Merges (deterministic wins; Claude fills judgment-only items) → returns a
   `QaProposal`. **This whole path writes NOTHING to the database.**

**Apply (writes) →** the user reviews the proposal, then clicks "Apply to
checklist + log issues" → `applyProposal(...)` (`actions.ts:149`).

## 2. What it calls / what it writes

- **External calls:** outbound `fetch` to the target URL and `/sitemap.xml`;
  the **Anthropic API** (Claude) when a key is present. No other services.
- **Writes (only in `applyProposal`, actions.ts:158–182):**
  - `db.qACheckItem.updateMany({ where: { certificateId, name }, data: { result, valueDesktop } })`
    — sets the checklist row's `result` (PASSED/FAILED/NA) and `valueDesktop`.
  - `db.issue.createMany(...)` — inserts `Issue` rows (status OPEN).

## 3. Does it write into the human checklist rows directly? — **YES (finding)**

`applyProposal` writes straight into **`QACheckItem`** — the human checklist
table — matching rows by `(certificateId, name)` and **overwriting** whatever
value was there. Two things matter for Phase 3:

- **It is human-ATTENDED today.** The write happens only on an explicit "Apply"
  click after the human reviews the dialog. So it does **not** currently violate
  the constitution's "no unattended machine writes to the human checklist" — but
  it sits exactly on that line.
- **It is a blunt, provenance-less overwrite.** There is **no column** marking a
  value as machine-proposed vs human-confirmed, and no diff/merge — an Apply
  silently replaces prior human input by name. Nothing records that a row was
  AI-set.

→ **Phase-3 collision surface:** §4's auto-fill battery fires on
`deliverable.ready_for_qa` and would want to pre-answer these same rows. It must
**not** reuse `applyProposal`'s unattended-capable, provenance-less
`updateMany`-by-name path. Phase 3 needs (a) a provenance/evidence signal
(machine-verified + evidence link) and (b) human confirmation before values
become the certificate's answers — per §10 (closing certificate: machine
pre-answers, human signs).

## 4. Usage evidence (read-only prod query, 2026-07-15)

| pages | certificates | check items | graded (≠ NA) | issues |
|---|---|---|---|---|
| 231 | 231 | 8,778 | **278 (3.2%)** | 1,741 |

There is **no usage instrumentation** (no AI-run log, no provenance flag), so AI
applies cannot be isolated from manual edits in the data. But the graded rate is
only ~3% — consistent with mostly-imported history and **light use of the
apply path** (broad AI use would have graded far more rows). The 1,741 issues
are plausibly human-logged; unattributable either way.

## 5. Recommendation — **ABSORB into Phase 3 (with provenance), do not retire**

`runQaAgent` already *is* §4's battery in embryo: it fetches a URL and produces
machine checks whose names line up with the template. Retiring it discards a
working engine; leaving it as-is risks the "two competing pre-fill concepts" §3
warns against.

**Proposed shape (for Phase 3, not now):**
- Reuse `runQaAgent`'s fetch + deterministic checks as (part of) the battery.
  Keep Claude judgment optional and graceful, exactly as today.
- **Replace the blunt `applyProposal` overwrite** with a provenance-tracked
  pre-fill: machine results land in a machine-evidence surface (a new column/
  table with evidence + `machine_verified` provenance), never silently into
  `QACheckItem.result` unattended. The human confirms; confirmation is the write.
- **Migration of existing outputs:** none. Past applies are indistinguishable
  from human edits (no provenance) — there is nothing to back-fill or undo;
  provenance begins going forward.

**Tradeoffs:** absorb = one pre-fill concept, aligned with §4/§10, but requires a
schema addition (additive) for provenance in Phase 3. Coexist = faster now, but
two engines drift. Retire = loses working code for no benefit.

*Gate 0A is diagnosis only. No code changed; the write path above was read, not
run. Phase 3 acts on this ADR after operator acceptance.*
