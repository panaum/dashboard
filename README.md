# Apexure QA ecosystem

Four apps, three services and one shared contract that together answer a single
question for every page Apexure ships: **is this deliverable actually correct,
and can we prove it to the client?**

Built as a monorepo on 2026-08-31 from three separate repositories, with full
git history preserved (`git log --follow` still works across the moves).

```
                         ┌──────────────────────────────┐
                         │  apps/shell — the front door │
                         │  Google sign-in @apexure.com │
                         └───────────────┬──────────────┘
                    signed HMAC handoff  │  (≤5 min, SPINE_SECRET)
                 ┌───────────────────────┴────────────────────────┐
                 ▼                                                ▼
   ┌──────────────────────────────┐              ┌──────────────────────────────┐
   │ apps/dashboard               │   spine bus  │ apps/linkspy                 │
   │ Deliverables Dashboard       │◀────────────▶│ LinkSpy frontend             │
   │ Next 16 · Prisma · Postgres  │  (HMAC, at-  │ Next.js · NextAuth v4        │
   │                              │  least-once) │                              │
   │ QA · Boards · Layout checks  │              └──────────────┬───────────────┘
   │ Certificates · Reports       │                             │
   └───────┬──────────────────────┘                             ▼
           │                                   ┌──────────────────────────────┐
           │  HTTP (keyed)                     │ services/linkspy-api         │
           ├──────────────────────────────────▶│ FastAPI · Playwright         │
           │                                   │ scans · monitoring · jobs    │
           │                                   └──────────────────────────────┘
           │        ┌──────────────────────────┐   ┌──────────────────────────┐
           └───────▶│ services/devicepreview   │   │ services/pagecheck       │
                    │ 15-profile render matrix │   │ pre-launch page verdict  │
                    └──────────────────────────┘   └──────────────────────────┘
```

| Path | What it is | Runs on |
|---|---|---|
| [`apps/dashboard`](apps/dashboard) | **Deliverables Dashboard** — clients, projects, pages, QA, issue boards, certificates | Vercel `dashboard` |
| [`apps/linkspy`](apps/linkspy) | **LinkSpy** frontend — link/attribution scans and monitoring | Vercel `brokenlinkchecker` |
| [`services/linkspy-api`](services/linkspy-api) | LinkSpy backend — crawling, monitoring, jobs, self-heal | Railway |
| [`apps/shell`](apps/shell) | The **door page** — one Google sign-in, signed handoffs to the other two | Vercel `qa-ecosystem` |
| [`services/devicepreview`](services/devicepreview) | Cross-device render matrix + layout audit | CLI / Railway |
| [`services/pagecheck`](services/pagecheck) | Single-page pre-launch checker | CLI / local UI |
| [`apps/linkspy-extension`](apps/linkspy-extension) | Browser extension | — |
| [`packages/qa-tokens`](packages) | Shared design tokens | — |

**785 commits · ~122,000 lines across 900+ tracked files · 2,020 automated tests.**

---

## What each part does

### Deliverables Dashboard — the spine of the operation

The tool the QA team lives in. Ten sections, each backed by real data rather
than a spreadsheet tab:

| Section | What it answers |
|---|---|
| **Overview** | What's in flight, what's late, what's failing — issues by severity and the delivery pipeline at a glance |
| **Monthly** | Delivery + QA rollup per month, CSV export, on-time-delivery per developer |
| **Clients** | Client → Project → Page drill-down with inline editing |
| **Sites** | Live LinkSpy status per site: broken links, attribution, consent, Core Web Vitals |
| **Layout checks** | How a page renders across a device matrix, with layout defects flagged, 3D device frames and before/after run diffs |
| **Boards** | Trello-style QA ↔ developer issue tracking (below) |
| **Team** | Workload and quality per person — pages built, issues found, board performance |
| **Checklists** | Reusable QA checklist templates, scoped per platform |
| **Candidates** | Checklist items the system proposes from real findings (the flywheel) |
| **Insights** | Cross-client quality trends |

Plus a **client-facing QA certificate** per page — printable, shareable by
capability link, and *living*: it re-verifies itself against LinkSpy and shows
the client a health timeline rather than a stale PDF.

### Boards — QA ↔ developer issue tracking

Five stages (New → Active → Needs clarification → Completed → Closed), built on
the existing `Issue` table rather than a parallel model.

- **Two views, one model.** QA sees everything. The developer reaches one board
  through a **capability link** — no login, no navbar, no route into the rest of
  the app — and `developerView()` is a *whitelist*, so a field added to `Issue`
  later is hidden by default rather than leaked by default. No severity, no
  recurring flag, no reporter. Priority reaches the developer as card **order**.
- **Only QA closes; only QA reopens.** "The developer says done" and "QA
  confirmed" are two people's acts, and the **bounce-back** metric lives in the
  gap between them — the one number a developer cannot inflate.
- **Paste a screenshot** into *+ Add a card* and the card is created with that
  image as its cover, named after the file.
- **A card back** modelled on Trello's: cover banner, stage pill, inline title
  and description, attachments with a cover control, and one chronological feed
  that interleaves comments with stage changes — no separate activity table,
  because `IssueEvent` already is one.
- **@mentions scoped to the card's two people**, stored as structured rows
  (never re-parsed from text), delivered to Slack. Replies ping the other side
  whether or not they were tagged.
- **Dates** — start, due with time, and a reminder swept by cron into Slack.
- **Every metric is computed from the event log**: cycle time (first New →
  first Completed), bounce-backs, recurring count, assigned vs closed — shown
  per developer per month in a panel that sits *beside* the delivery view and is
  never blended into one score.

### LinkSpy — what the client's page is really doing

Crawls a site and reports what marketing tooling and QA usually miss: broken
links and dead CTAs, attribution and UTM integrity, consent/CMP behaviour, form
capture, redirect chains, Core Web Vitals, and drift over time. It monitors on a
schedule, opens fix PRs where it can, and alerts to Slack only after delivery is
confirmed.

It never contaminates what it measures. Scanning a client's page used to fire
that client's analytics; the fix was structural rather than a rule to remember —
**no module opens a browser of its own**, every context comes from one guarded
place with the collector endpoints already refused, and a test fails the build
if a new caller creates one directly. Opting out is possible and deliberately
awkward: it takes a written reason, not a boolean.

### devicepreview & pagecheck — the honest-label services

- **devicepreview** renders a URL across a fixed fifteen-profile matrix using all
  three Playwright engines and flags layout defects with a self-contained
  gallery. House rule, enforced by ADR-003: **never a false FAIL** — when the
  evidence is ambiguous it warns, and it stops at the honest label rather than
  guessing.
- **pagecheck** gives a single landing page a pre-launch verdict: will it
  actually capture leads and attribution, or is it silently losing them? Its
  responsive engine is mirrored into the LinkSpy backend to power the
  Dashboard's Layout checks.

---

## How the pieces stay honest

This is the part worth reading twice.

**One database, no point-in-time recovery.** Both Supabase projects are free
tier. Everything below follows from that.

- **[ADR-001](docs/decisions/001-prisma-migrate-and-additive-ddl.md): `prisma db push` and `db:reset` are banned.** Prisma
  Migrate only, additive DDL only, and a **verified `pg_dump` before every
  migration**. The ban is not a convention — `npm run guard:db` runs as
  `prebuild`, so any build fails if a banned command is reintroduced.
- **Migrations are applied and verified in production *before* the PR that needs
  them is opened.** A PR merged ahead of its migration takes the site down, and
  did once; the rule exists because of that day.
- **Duplicated contracts are checksum-guarded.** The spine envelope and the
  handoff token exist in both TypeScript and Python. Each copy carries a
  `CONTRACT_CHECKSUM` / `HANDOFF_CHECKSUM` of the canonical spec, and the tests
  fail if the copies drift. Change them in every copy or not at all.
- **Capability links, not accounts.** A client certificate and a developer board
  are each reached by a random token on the row — minted behind a permission,
  nulled to revoke, and answering `404` to any miss so it cannot be probed.
- **Attribution or null, never a guess.** Board events, comments and minted links
  record the signed-in member. The shared team password has no person behind it,
  so it records `null` — visibly, rather than attributing to nobody in
  particular.
- **Delivery is confirmed before state advances.** Alerts and reminders only mark
  themselves sent after the channel confirms; a failed sweep is retried by the
  next one, never counted as success. Every sweep reports completed-vs-given.

## Testing

| Suite | Count | Command |
|---|---|---|
| Dashboard unit (pure logic, no DB, no clock) | **769** | `cd apps/dashboard && npm test` |
| Dashboard end-to-end (Playwright) | 17 specs | `npm run e2e` |
| LinkSpy backend | **1,155** | `cd services/linkspy-api && pytest tests/` |
| devicepreview | **96** | `cd services/devicepreview && ../pagecheck/.venv/bin/python -m unittest tests.test_audit` |

Non-trivial logic lives in pure modules outside React and Prisma — periods,
scoring, whitelists, feed ordering, reminder windows — so it can be tested
without a database or a clock. Beyond the counts, three gates run continuously:

- **A contrast ratchet** that fails the build on a new contrast failure *and* on
  a stale exemption.
- **An API-auth isolation test** that asserts every route under `/api` declares
  which credential it accepts, so a new route cannot quietly ship unguarded.
- **[A rendering-verification standard](apps/dashboard/CLAUDE.md)**: anything touching uploads or rendered UI is
  verified against a production build with real screenshots at 1280 and 390 that
  a human looks at — because DB and DOM assertions have twice been green while
  the picture was broken.

---

## Getting started

There is **no root workspace**. Each app owns its `package.json` and lockfile;
`cd` into the one you're working on.

```bash
# Dashboard (the usual starting point)
cd apps/dashboard
npm install
cp .env.example .env          # DATABASE_URL, DIRECT_URL, APP_PASSWORD, AUTH_SECRET
npm run db:migrate            # never `db push` — see ADR-001
npm run dev                   # http://localhost:3000

# LinkSpy backend
cd services/linkspy-api
pip install -r requirements.txt && playwright install chromium
uvicorn main:app --reload --port 8000
pytest tests/

# devicepreview
cd services/devicepreview
../pagecheck/.venv/bin/python devicepreview.py https://example.com/ --tier all
open runs/<timestamp>/report.html
```

Prisma needs `?sslmode=require` in the Supabase URL — it ignores `PGSSLMODE`,
and without it `migrate deploy` hangs for ten minutes and then reports a
connection error that reads exactly like an outage on a host that is up.

## Where the answers live

| File | What it settles |
|---|---|
| **[`INFRASTRUCTURE.md`](INFRASTRUCTURE.md)** | Every deployment surface, env var, shared secret and feature flag, plus the open-defect register (D1–D11). The single source of truth — update it in the same PR as any deployment-config change. |
| **[`CLAUDE.md`](CLAUDE.md)** (root and per-app) | Working agreements for this codebase: conventions, invariants, the rules above stated where they bind. |
| [`docs/decisions/`](docs/decisions) | ADRs — why migrations are additive, what "Run AI QA" does, where devicepreview stops, why the 3D device frame is internal-only. |
| [`docs/runbooks/`](docs/runbooks) | Backups, the devicepreview volume, the living certificate. |
| [`docs/linkspy/`](docs/linkspy) | LinkSpy architecture, design standards, frontend contract. |
| [`docs/design-notes/`](docs/design-notes) | Phase notes — registry, spine, flywheel, presence, certificates. |

## Stack

**TypeScript** — Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4,
Prisma 6, motion, three. **Python** — FastAPI, Playwright, Supabase.
**Data** — PostgreSQL (Supabase ×2). **Hosting** — Vercel ×3, Railway ×1.
**AI** — Claude, via `@anthropic-ai/sdk`, for the QA judgment layer (optional:
absent key ⇒ deterministic results still return).

## Conventions

- Server Components by default; mutations are **server actions** colocated with
  the route.
- **Design tokens, never raw hex.** Sentence case in UI copy; no "easily /
  simply / just / powerful".
- Modals use the portal-based `Dialog` — a `fixed` modal inside the transformed
  page-transition wrapper gets clipped.
- Enum-like columns are stored as `String` with the allowed values in
  `constants.ts`, so adding one is a code change, not a migration.
- New dependencies are a conversation, not a commit.
