# Deliverables Dashboard

Internal tool for Apexure to track client websites / landing pages and their QA —
replacing the team's tracking spreadsheet. Built for the team (no client-facing
logins in v1, though pages export a client-facing QA certificate).

## Features

- **Dashboard** — clients, projects, pages, QA status and open issues at a glance,
  with live "issues by severity" and "delivery pipeline" panels.
- **Drill-down CRUD** — Client → Project → Page, each with inline editing.
- **QA module** — per-page checklist, issue log, and an AI QA agent (deterministic
  checks + Claude judgment) that can draft issues from a live URL.
- **Configurable checklist templates** — build reusable QA checklists, scope them
  per platform, and set a default; new pages seed from the matching template.
- **Client-facing QA certificate** — a polished, printable/PDF certificate per page.
- **Live site previews** — real screenshots of a page's URL.
- **Team** — workload and quality per developer/tester, with avatars.
- **Monthly report** — delivery + QA rollup with CSV export and an "add month" picker.
- **Command palette (⌘K)** — jump to any client, project or page.
- Instant filters, inline status changes, CSV export, and motion throughout.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme`) + **Geist** font
- **Prisma 6** ORM — **SQLite** in dev (switch to Postgres for production)
- **motion** (Framer Motion) for animation
- Auth: shared team password + signed HTTP-only cookie

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create .env (see below)

# 3. Apply the schema to a local SQLite DB
npm run db:push

# 4. Load data — choose one:
npx tsx prisma/import-2026.ts     # real 2026 dataset (wipes + imports)
npm run db:seed                   # small Savvio demo seed
npx tsx prisma/seed-templates.ts  # seed the default QA checklist template

# 5. Run it
npm run dev                       # http://localhost:3000
```

### Environment variables (`.env`)

```bash
# Path to the SQLite file. Keep it OUTSIDE any synced folder (OneDrive/Dropbox)
# — sync locks corrupt the DB and the Turbopack cache.
DATABASE_URL="file:C:/Users/<you>/.dashboard-db/dev.db"

APP_PASSWORD="change-me"            # the shared team login password
AUTH_SECRET="a-long-random-string" # signs the session cookie

ANTHROPIC_API_KEY="sk-ant-..."     # optional — enables the AI QA judgment layer
```

`.env` and the SQLite database are gitignored and never committed.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run db:push` | Apply schema changes to the DB |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run db:reset` | Wipe + re-seed (demo seed) |

## Notes

- **Production:** switch the Prisma datasource to `postgresql`, promote the
  enum-like `String` fields to real enums, host the app, and migrate the data.
- More implementation detail lives in [`CLAUDE.md`](./CLAUDE.md).
