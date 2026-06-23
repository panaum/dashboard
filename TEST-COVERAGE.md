# Test coverage

Single source of truth for what's tested and what isn't. Every testable element
across the dashboard, with how bad a **silent** break would be (it still renders,
no error, but the data is wrong) and whether a test currently guards it.

**Keep this honest:** whenever a new test is written, tick the matching line and
add the test file. `[x]` = a real test asserts it today; `[ ]` = to-do. Ask
"what's still unchecked in TEST-COVERAGE.md?" anytime to get the remaining list.

**Severity** — impact of a silent break: **Critical** (wrong data leaves the
building or drives decisions) · **High** (wrong, hard to notice, real harm) ·
**Medium** (visible-ish, contained) · **Low** (cosmetic / convenience).

**Test files today:** `e2e/login.spec.ts`, `e2e/auth.setup.ts`,
`e2e/dashboard.spec.ts`, `e2e/reports.spec.ts`, `e2e/overview.spec.ts`,
`e2e/search.spec.ts`, `e2e/team.spec.ts`, `e2e/team-crud.spec.ts`,
`e2e/insights.spec.ts`, `e2e/certificate.spec.ts`, `e2e/issue-log.spec.ts`,
`e2e/qa-checklist.spec.ts`, `e2e/search-filters.spec.ts`,
`e2e/checklists-crud.spec.ts`, `e2e/clients.spec.ts`, `e2e/clients-crud.spec.ts`,
`src/lib/insights.test.ts`, `src/lib/csv.test.ts`, `src/lib/page-search.test.ts`.

---

## Auth / Login (`/login`, public)

- [x] Login page loads — heading + password field + Sign in button — Medium → `e2e/login.spec.ts`
- [x] Empty submission blocked by required validation (stays on /login) — Medium → `e2e/login.spec.ts`
- [x] Correct password → session created and reused across specs — Critical → `e2e/auth.setup.ts`
- [x] Wrong password shows "Incorrect password." error — High → `e2e/login.spec.ts`

## Overview (`/dashboard`)

- [x] Loads while authenticated, no redirect to /login — Critical → `e2e/dashboard.spec.ts`
- [x] Sidebar nav present (Insights link visible and navigates) — Medium → `e2e/dashboard.spec.ts`
- [x] 5 stat tiles render numeric values (Clients · Projects · Pages · In QA · Open issues) — High → `e2e/overview.spec.ts`
- [x] "Issues by severity" bars sum to the total count — Medium → `e2e/overview.spec.ts`
- [x] "Delivery pipeline" status bars sum to total Pages — Medium → `e2e/overview.spec.ts`
- [ ] Recent projects list links to the right drill-down — Low → not yet covered

## Monthly report (`/dashboard/reports`)

- [x] Month picker actually filters the page (`?month=`) — Critical → `e2e/reports.spec.ts`
- [x] Pages delivered KPI — Critical → `e2e/reports.spec.ts`
- [x] Total issues KPI == sum of severity bars (invariant) — Critical → `e2e/reports.spec.ts`
- [x] Total issues KPI == sum of table Issues column (invariant) — Critical → `e2e/reports.spec.ts`
- [x] Pages delivered KPI == delivery-table row count (invariant) — Critical → `e2e/reports.spec.ts`
- [ ] Avg issues / page KPI — Critical → not yet covered
- [ ] Avg delay (days) KPI — High → not yet covered
- [ ] Issues-by-severity chart — High → not yet covered
- [ ] Pages-by-platform chart — Medium → not yet covered
- [ ] Delivery table (page · client · developer · tester · issues · delay) — High → not yet covered
- [x] Export CSV matches the filtered data — Critical → `e2e/reports.spec.ts`
- [ ] Empty-month state message — Low → not yet covered

## Search (`/dashboard/search`)

- [x] Text query (q) returns matching pages, case-insensitively — High → `e2e/search.spec.ts`
- [x] Developer filter — count equals that developer's built pages — High → `e2e/search-filters.spec.ts`
- [x] Tester filter — count equals that tester's QA'd pages — High → `e2e/search-filters.spec.ts`
- [x] Export CSV matches active filters (rows == result count) — High → `e2e/search-filters.spec.ts`
- [ ] Combined filters (`buildPageWhere`) — High → not yet covered
- [ ] Platform filter — Medium → not yet covered
- [ ] Status filter — Medium → not yet covered
- [ ] Month filter — Medium → not yet covered
- [ ] Result count + "first 100" cap note — Medium → not yet covered
- [x] Clear filters returns to the empty prompt — Low → `e2e/search-filters.spec.ts`
- [ ] No-filter prompt + ⌘K tip — Low → not yet covered

## Clients (`/dashboard/clients`)

- [x] Filter box narrows the list (client-side) — Medium → `e2e/clients.spec.ts`
- [x] Card links to the right client detail — Medium → `e2e/clients.spec.ts`
- [x] No-match empty state — Low → `e2e/clients.spec.ts`
- [x] Add client (dialog write) + delete (create-then-delete) — High → `e2e/clients-crud.spec.ts`
- [ ] Client cards show correct project / page counts — Medium → not yet covered

## Team (`/dashboard/team`)

- [x] 4 stat tiles agree with the member table (People == rows, Developers ⊆ People) — Medium → `e2e/team.spec.ts`
- [ ] Team table rows: built / tested / repetitive per member (attribution) — High → not yet covered
- [x] Add member (dialog write) + remove (create-then-delete) — High → `e2e/team-crud.spec.ts`
- [ ] Drill-down to member detail — Medium → not yet covered

## Team member detail (`/dashboard/team/[memberId]`)

- [ ] Stat tiles (built · QA'd · avg issues · repetitive) — Medium → not yet covered
- [ ] Built / QA'd page lists — Medium → not yet covered
- [ ] Pages-built-per-month chart — Low → not yet covered

## Insights (`/dashboard/insights`)

- [x] Page renders with "Insights" heading (authenticated nav) — Medium → `e2e/dashboard.spec.ts`
- [x] Aggregation logic — totals, avg issues, on-time %, platform & developer ranking, plus zero / negative / division-by-zero / empty inputs — Medium → `src/lib/insights.test.ts`
- [x] KPI tiles render on the page (Pages · Avg issues · On-time · Repetitive) — Medium → `e2e/insights.spec.ts`
- [x] Platform / quality-trend / developer-leaderboard sections render — Medium → `e2e/insights.spec.ts`
- [ ] Auto-flagged callouts render — Low → not yet covered

## QA checklists (`/dashboard/checklists`)

- [x] New template (create write) — High → `e2e/checklists-crud.spec.ts`
- [x] Delete template (destructive, confirm) — High → `e2e/checklists-crud.spec.ts`
- [x] Drill-down to template editor (create opens it) — Medium → `e2e/checklists-crud.spec.ts`
- [ ] Template list with check counts + Default badge — Medium → not yet covered

## Checklist editor (`/dashboard/checklists/[templateId]`)

- [x] Delete template — High → `e2e/checklists-crud.spec.ts`
- [ ] Edit template items — Medium → not yet covered

## Client → Project → Page drill-down

- [x] Page detail: issue log — add an issue then remove it (create-then-delete) — Critical → `e2e/issue-log.spec.ts`
- [x] Page detail: QA checklist editor — grade a check, progress updates, restore — Critical → `e2e/qa-checklist.spec.ts`
- [ ] Page detail: AI QA analyse → apply proposal — High → not yet covered
- [ ] Project detail: edit project incl. developer + tester — High → not yet covered
- [x] Client detail: delete client (create-then-delete) — High → `e2e/clients-crud.spec.ts`
- [ ] Client detail: projects list / add project — High → not yet covered
- [x] Share certificate: create / revoke public link — High → `e2e/certificate.spec.ts`
- [x] Public certificate (`/c/[shareId]`) renders for the client + dies on revoke — High → `e2e/certificate.spec.ts`
- [ ] Internal certificate page render / print — Medium → not yet covered

## Library / pure logic (unit tests)

- [x] Insights aggregation (`computeInsights`) — totals, averages, ranking, zero / negative / empty — Medium → `src/lib/insights.test.ts`
- [x] CSV builder (`toCsv` / `csvResponse`) — formula-injection guard, RFC-4180 quoting, numbers preserved, BOM — Medium → `src/lib/csv.test.ts`
- [x] Page search (`buildPageWhere` case-insensitive mode, scalar/nested filters, `hasAnyFilter`) — High → `src/lib/page-search.test.ts`

---

### Suggested order to burn down the `[ ]`

1. **Monthly report invariants** (the Critical cluster) — highest damage, only real filter.
2. **Overview stat tiles render** — cheap guard that the first screen isn't broken.
3. **Search filters** (developer / tester / combined) — attribution + the densest filter logic.
4. **CRUD writes** (add client / member, create/delete template) — they mutate data.
5. **Drill-down QA workflow + public certificate** — the core product loop and the client-facing surface.
