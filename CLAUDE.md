# Deliverables Dashboard

Internal tool that replaces Apexure's Google Sheet for tracking client websites /
landing pages and their QA. Built for the team only (no client-facing views in v1).

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme` in `src/app/globals.css`)
- **Prisma 6** ORM, **SQLite** in dev (`prisma/dev.db`)
- Auth: shared team password + signed HTTP-only cookie (no external auth provider)
- Icons: `lucide-react`. Utilities: `clsx` + `tailwind-merge` via `cn()`.

## Data model (`prisma/schema.prisma`)

Hierarchy: **Client → Project → Page → (QACertificate + Issues)**

- `Client` — a client (e.g. Savvio, BKCF, Hutch).
- `Project` — a deliverable; `type` = WEBSITE | LANDING_PAGE; `platform` (WordPress,
  Webflow, Unbounce, HubSpot, Podia, GHL, Wix, Other); `status`.
- `Page` — a page within a project (a landing page = a single-page project).
  Holds `developerId`, `testerId`, `delayDays`, `deliveryMonth` ("2026-01").
- `Issue` — a bug on a page with `severity` (CRITICAL_HIGH | MEDIUM | LOW | REPETITIVE).
  Severity **counts are derived** by counting issues — never typed by hand.
- `TeamMember` — developers and testers; assigned to pages.
- `QACertificate` (1 per page) → `QACheckItem[]` — the QA checklist.

### Enums are stored as `String`

SQLite has no native enums. Allowed values + labels + UI tones live in
**`src/lib/constants.ts`** — the single source of truth. When moving to Postgres for
production, switch the datasource and promote these to real Prisma enums.

## QA checklist

The standard checklist (from the "Live Checklist LLUM LP" sheet) is defined in
**`src/lib/qa-template.ts`** and seeded into each new certificate via
`buildChecklistItems()`. Items can be a plain Passed/Failed/NA, a measurement
(`isMeasurement` — load time, page size), or dual Desktop/Mobile (`hasDualValue` —
browser tests, PageSpeed).

## Conventions

- Server Components by default; data fetched directly via `db` from `src/lib/db.ts`.
- Mutations are **server actions** (`actions.ts` colocated with the route).
- UI primitives in `src/components/ui` (`Button`, `Card`, `Badge`, `StatusBadge`).
  Shared layout pieces in `src/components/shared`.
- Use design tokens, never raw hex: `bg-brand-primary`, `text-secondary`,
  `rounded-lg`, `shadow-sm`, etc. See `designsystem.md` (Retainable design system).
- Sentence case for UI copy. Avoid "easily / simply / just / powerful".
- Status/severity → badge tone via the `*_TONE` maps in `constants.ts`.

## Auth

- `src/lib/auth.ts` — `checkPassword`, `createSession`, `requireAuth`, etc.
- Password in `APP_PASSWORD`, cookie signed with `AUTH_SECRET` (both in `.env`).
- `src/proxy.ts` redirects unauthenticated `/dashboard/*` requests to `/login`
  (lightweight presence check). Full verification is in the dashboard layout.

## Commands

```bash
npm run dev        # start dev server (localhost:3000)
npm run build      # production build
npm run db:push    # apply schema changes to SQLite
npm run db:seed    # seed team + sample Savvio website
npm run db:reset   # wipe + re-seed
npm run db:studio  # Prisma Studio (browse data)
```

Default login password (dev): `apexure` — change `APP_PASSWORD` in `.env`.

## Data

- DB lives **outside OneDrive** at `C:/Users/anaum/.dashboard-db/dev.db` (OneDrive
  was locking the SQLite file → writes failed). Set in `DATABASE_URL`.
- Real 2026 data (Jan–June, ~213 pages) is in `prisma/import-data.ts`; the loader
  is `prisma/import-2026.ts` (`npx tsx prisma/import-2026.ts`). It **wipes and
  re-imports** — it groups pages under client websites, maps platforms, builds the
  team, and creates issues + QA certificates. Re-runnable.
- `prisma/seed.ts` is the original sample seed (Savvio demo) — superseded by the
  import; don't run both.

## Roadmap status

- [x] Phase 0–1: scaffold, design system, schema, auth, dashboard shell
- [x] Phase 2: full CRUD (client → project → page drill-down) + page detail
- [x] Phase 3: QA module (animated checklist editor + issue log) + team CRUD
- [ ] Phase 4: team assignment filtering (assignment done; add filter views)
- [ ] Phase 5: CSV importer (the monthly sheet) — skipped for now
- [x] Phase 6: monthly report dashboard (month picker, severity/platform charts, delivery table)
- [x] Phase 7: AI layer — URL-based QA agent (deterministic checks + Claude judgment)
- [ ] Phase 8: deploy (switch to Postgres)

## AI QA agent (Phase 7)

`src/lib/ai/qa-agent.ts` — `runQaAgent(url)`:
- **Deterministic checks** (no API key needed): fetches the page and verifies SSL,
  favicon, SEO title/description, Open Graph tags, H1, GA / Ads / Meta-pixel,
  sitemap.xml, page size, rough load time, copyright year.
- **Claude judgment** (`claude-opus-4-8`, structured output via `messages.parse` +
  Zod): spelling, privacy page, CTA, and suggested issues by severity. Activates
  only when `ANTHROPIC_API_KEY` is set; absent → deterministic results still return.

Server actions in the page-detail `actions.ts`: `analyzeUrl` (runs the agent, no
writes) and `applyProposal` (updates matching `QACheckItem`s by name + creates
issues). UI: `src/components/qa/ai-qa.tsx` (`AiQaButton`) — analyse → review → apply.
