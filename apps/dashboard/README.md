# Deliverables Dashboard

The tool Apexure's QA team works in: every client site and landing page, the QA
done on it, the issues found, who fixed them, and a certificate the client can
read. It replaced a tracking spreadsheet and has not looked back.

Part of the [Apexure QA ecosystem](../../README.md) monorepo. **769 unit tests,
17 end-to-end specs, 21 Prisma models, 29 pages, 24 API routes.**

## Sections

| Section | What it answers |
|---|---|
| **Overview** | What's in flight, what's late, what's failing — issues by severity, delivery pipeline |
| **Monthly** | Delivery + QA rollup per month, on-time delivery per developer, CSV export |
| **Clients** | Client → Project → Page drill-down, inline editing everywhere |
| **Sites** | Live LinkSpy status per site — broken links, attribution, consent, Core Web Vitals |
| **Layout checks** | How a page renders across devices, defects flagged, 3D device frames, before/after run diffs |
| **Boards** | QA ↔ developer issue tracking, five stages, developer reaches one board by capability link |
| **Team** | Workload and quality per person, plus board performance from the event log |
| **Checklists** | Reusable QA checklist templates, scoped per platform, defaults seeded onto new pages |
| **Candidates** | Checklist items proposed from real findings |
| **Insights** | Cross-client quality trends |

Throughout: a **⌘K command palette** that jumps to any client, project or page;
instant filters; inline status changes; CSV export.

### The QA certificate

Each page can publish a client-facing certificate at `/c/<shareId>` — a random
token on the row, minted behind a permission and nulled to revoke. It is
*living*: it re-verifies against LinkSpy and shows a health timeline, rather
than freezing a PDF at hand-off.

### Boards

Five stages — New, Active, Needs clarification, Completed, Closed — built on the
existing `Issue` table (`boardStage` null means "not on a board", so the 2,300+
page-review issues are untouched).

The developer opens **one** board through a capability link: no login, no
navbar, no route into the rest of the app. `developerView()` in
[`src/lib/boards.ts`](src/lib/boards.ts) is a **whitelist** — a field added to
`Issue` later is hidden by default, not leaked by default. Severity, the
recurring flag and the reporter never leave the server for that view; priority
arrives as card order.

Only QA closes and only QA reopens, so **bounce-backs** (Completed/Closed →
Active) mean something. Every board metric — cycle time, bounce-backs,
recurring count, assigned vs closed — is computed from `IssueEvent`, one row per
stage change, and shown per developer per month **beside** the delivery view,
never blended into a single score.

Also: paste a screenshot to create a card, Trello-style card back with a cover
and one chronological comments-and-activity feed, @mentions scoped to the card's
two people and delivered to Slack, due dates with reminders.

### AI QA

"Run AI QA" on a page combines deterministic checks (favicon, SEO tags, Open
Graph, H1, analytics tags, sitemap, page weight, rough load time) with a Claude
judgment layer (spelling, privacy page, CTA quality, suggested issues by
severity) and drafts issues you can accept. It activates only when
`ANTHROPIC_API_KEY` is set; without it the deterministic results still return.
See [ADR-002](../../docs/decisions/ADR-002-run-ai-qa.md).

## Stack

**Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** ·
**Tailwind CSS v4** (CSS-first `@theme`) · **Prisma 6** → **PostgreSQL**
(Supabase) · **motion** · **three** (3D device frames) · `@anthropic-ai/sdk`.

Auth today is a shared team password plus a signed HTTP-only cookie, with
per-person logins and rank-based capabilities available on the Team page.

## Getting started

```bash
npm install
cp .env.example .env     # fill in the values below
npm run db:migrate       # NEVER `prisma db push` — see ADR-001
npm run dev              # http://localhost:3000
```

Point `DATABASE_URL` at a local Postgres or a scratch database — **not** at
production. There is no point-in-time recovery on the production database, and
a test row written there is a test row in the client's numbers.

### Environment

| Var | What it does |
|---|---|
| `DATABASE_URL` | Pooled connection (Supabase port 6543, `?pgbouncer=true`) — app runtime |
| `DIRECT_URL` | Session connection (port 5432) — migrations. Needs **`?sslmode=require`**: Prisma ignores `PGSSLMODE`, and without it `migrate deploy` hangs for ten minutes and then reports a connection error that reads like an outage |
| `APP_PASSWORD` | Shared team login, timing-safe compared |
| `AUTH_SECRET` | Signs the session cookie |
| `ANTHROPIC_API_KEY` | Optional — enables the AI QA judgment layer |
| `LINKSPY_API_URL` / `LINKSPY_API_KEY` / `LINKSPY_APP_URL` | LinkSpy integration (Sites, certificates) |
| `DEVICEPREVIEW_URL` / `DEVICEPREVIEW_KEY` | Device preview service; the section is silent when unset |
| `SLACK_WEBHOOK_URL` | Board @mention and due-date pings; unset ⇒ mentions are stored with `notifiedAt` null and the app says so |

`.env` is gitignored and never committed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (runs the `db push` guard first, then `prisma generate`) |
| `npm test` | 769 unit tests — pure logic, no database, no clock |
| `npm run e2e` | Playwright end-to-end specs |
| `npm run db:migrate` | Create + apply a migration in dev |
| `npm run db:deploy` | Apply pending migrations (production) |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run contrast` | Contrast audit |
| `npm run guard:db` | Fails if a banned Prisma command reappears |

There is no `db:push` and no `db:reset`. Both are banned by
[ADR-001](../../docs/decisions/001-prisma-migrate-and-additive-ddl.md) and
`scripts/guard-no-db-push.mjs` runs as `prebuild` to keep them gone.

## Working on this codebase

- Schema changes: **dump first** (`docs/runbooks/backup.md`), additive DDL,
  `prisma migrate`, verify against `information_schema`, and apply the migration
  to production *before* opening the PR that needs it.
- Keep non-trivial logic **pure and outside Server Components** (`src/lib/*.ts`)
  so it can be unit-tested without a database. No clock reads: pass `now` in.
- Anything touching uploads or rendered UI gets real screenshots at 1280 and 390,
  taken against a **production build**, that a human looks at.
- Enum-like columns are `String` with the values in `src/lib/constants.ts`.

The full working agreement is in [`CLAUDE.md`](./CLAUDE.md); deployment
configuration lives in [`INFRASTRUCTURE.md`](../../INFRASTRUCTURE.md).
