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
`e2e/dashboard.spec.ts`, `e2e/reports.spec.ts`, `src/lib/insights.test.ts`.

---

## Auth / Login (`/login`, public)

- [x] Login page loads — heading + password field + Sign in button — Medium → `e2e/login.spec.ts`
- [x] Empty submission blocked by required validation (stays on /login) — Medium → `e2e/login.spec.ts`
- [x] Correct password → session created and reused across specs — Critical → `e2e/auth.setup.ts`
- [ ] Wrong password shows "Incorrect password." error — High → not yet covered

## Overview (`/dashboard`)

- [x] Loads while authenticated, no redirect to /login — Critical → `e2e/dashboard.spec.ts`
- [x] Sidebar nav present (Insights link visible and navigates) — Medium → `e2e/dashboard.spec.ts`
- [ ] 5 stat tiles render numeric values (Clients · Projects · Pages · In QA · Open issues) — High → not yet covered
- [ ] "Issues by severity" bars + total count — Medium → not yet covered
- [ ] "Delivery pipeline" status bars — Medium → not yet covered
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
- [ ] Export CSV matches the filtered data — Critical → not yet covered
- [ ] Empty-month state message — Low → not yet covered

## Search (`/dashboard/search`)

- [ ] Text query (q) returns matching pages — High → not yet covered
- [ ] Developer filter — High → not yet covered
- [ ] Tester filter — High → not yet covered
- [ ] Combined filters (`buildPageWhere`) — High → not yet covered
- [ ] Export CSV matches active filters — High → not yet covered
- [ ] Platform filter — Medium → not yet covered
- [ ] Status filter — Medium → not yet covered
- [ ] Month filter — Medium → not yet covered
- [ ] Result count + "first 100" cap note — Medium → not yet covered
- [ ] Clear filters — Low → not yet covered
- [ ] No-filter prompt + ⌘K tip — Low → not yet covered

## Clients (`/dashboard/clients`)

- [ ] Add client (dialog write) — High → not yet covered
- [ ] Client cards show correct project / page counts — Medium → not yet covered
- [ ] Filter box narrows the list (client-side) — Medium → not yet covered
- [ ] Card links to the right client detail — Medium → not yet covered
- [ ] No-match empty state — Low → not yet covered

## Team (`/dashboard/team`)

- [ ] Team table rows: built / tested / repetitive per member (attribution) — High → not yet covered
- [ ] Add member (dialog write) — High → not yet covered
- [ ] 4 stat tiles (People · Developers · Pages built · Avg issues/page) — Medium → not yet covered
- [ ] Drill-down to member detail — Medium → not yet covered

## Team member detail (`/dashboard/team/[memberId]`)

- [ ] Stat tiles (built · QA'd · avg issues · repetitive) — Medium → not yet covered
- [ ] Built / QA'd page lists — Medium → not yet covered
- [ ] Pages-built-per-month chart — Low → not yet covered

## Insights (`/dashboard/insights`)

- [x] Page renders with "Insights" heading (authenticated nav) — Medium → `e2e/dashboard.spec.ts`
- [x] Aggregation logic — totals, avg issues, on-time %, platform & developer ranking, plus zero / negative / division-by-zero / empty inputs — Medium → `src/lib/insights.test.ts`
- [ ] KPI tiles render on the page (Pages · Avg issues · On-time · Repetitive) — Medium → not yet covered
- [ ] Platform / quality-trend / developer-leaderboard sections render — Medium → not yet covered
- [ ] Auto-flagged callouts render — Low → not yet covered

## QA checklists (`/dashboard/checklists`)

- [ ] New template (create write) — High → not yet covered
- [ ] Delete template (destructive, confirm) — High → not yet covered
- [ ] Template list with check counts + Default badge — Medium → not yet covered
- [ ] Drill-down to template editor — Medium → not yet covered

## Checklist editor (`/dashboard/checklists/[templateId]`)

- [ ] Edit template items — Medium → not yet covered
- [ ] Delete template — High → not yet covered

## Client → Project → Page drill-down

- [ ] Page detail: QA checklist editor + issue log (core QA workflow) — Critical → not yet covered
- [ ] Page detail: AI QA analyse → apply proposal — High → not yet covered
- [ ] Project detail: edit project incl. developer + tester — High → not yet covered
- [ ] Client detail: projects list / add project — High → not yet covered
- [ ] Share certificate: create / revoke public link — High → not yet covered
- [ ] Public certificate (`/c/[shareId]`) renders itemized cert (client-facing) — High → not yet covered
- [ ] Internal certificate page render / print — Medium → not yet covered

---

### Suggested order to burn down the `[ ]`

1. **Monthly report invariants** (the Critical cluster) — highest damage, only real filter.
2. **Overview stat tiles render** — cheap guard that the first screen isn't broken.
3. **Search filters** (developer / tester / combined) — attribution + the densest filter logic.
4. **CRUD writes** (add client / member, create/delete template) — they mutate data.
5. **Drill-down QA workflow + public certificate** — the core product loop and the client-facing surface.
