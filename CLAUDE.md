# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Deliverables Dashboard

Internal tool that replaces Apexure's Google Sheet for tracking client websites /
landing pages and their QA. Team-only dashboard, **plus** opt-in public QA
certificate links clients can view.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first `@theme` in `src/app/globals.css`)
- **Prisma 6** ORM → **PostgreSQL** (Supabase). The datasource uses a pooled
  `DATABASE_URL` (pgbouncer, port 6543) for the app and a session `DIRECT_URL`
  (port 5432) for migrations / bulk import. Deployed on **Vercel** (`vercel.json`
  pins functions to `syd1` to co-locate with the Sydney Supabase DB).
- Auth: shared team password + signed HTTP-only cookie (no external auth provider)
- Icons: `lucide-react`. Animation: `motion` (the `PageTransition` wrapper, etc.).
  Utilities: `clsx` + `tailwind-merge` via `cn()`.
- Testing: `node:test` (unit, via `tsx`) + **Playwright** (e2e in `e2e/`).

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
- **Modals must use the portal-based `Dialog`** (`src/components/ui/dialog.tsx`,
  `createPortal` to `document.body`). A `position: fixed` modal rendered inside the
  `PageTransition` motion wrapper is clipped, because a transformed ancestor becomes
  the containing block — the portal is the fix, don't revert it.
- Keep non-trivial aggregation **pure and outside Server Components** (e.g.
  `src/lib/insights.ts`) so it can be unit-tested without a DB. Avoid `Date`/timezone
  math in these: `deliveryMonth` is a stored `"2026-01"` string (sort lexically) and
  `delayDays` is a stored integer — no clock reads, so results are deterministic.

## Public QA certificates

- `Page.shareId` (nullable, unique) is an opt-in token. The page-detail `actions.ts`
  mints it (`createShareLink`) / clears it (`revokeShareLink`).
- `/c/[shareId]` is the **only unauthenticated route** under the app (it's outside
  `/dashboard/*`, so `src/proxy.ts` doesn't gate it); `robots: { index: false }`.
- Internal page detail and the public route both render the shared
  `src/components/qa/certificate-document.tsx` (itemized checklist, verdict, QR, seal).

## Auth

- `src/lib/auth.ts` — `checkPassword`, `createSession`, `requireAuth`, etc.
- Password in `APP_PASSWORD`, cookie signed with `AUTH_SECRET` (both in `.env`).
- `src/proxy.ts` redirects unauthenticated `/dashboard/*` requests to `/login`
  (lightweight presence check). Full verification is in the dashboard layout.

## Commands

```bash
npm run dev        # start dev server (localhost:3000)
npm run build      # prisma generate && next build
npm run lint       # eslint
npm test           # node:test runner via tsx (no test framework dependency)
npm run db:push    # apply schema changes to the DB
npm run db:seed    # seed team + sample Savvio website
npm run db:reset   # wipe + re-seed
npm run db:studio  # Prisma Studio (browse data)
npm run e2e        # Playwright e2e (builds + serves prod, then runs e2e/*.spec.ts)
npm run e2e:ui     # Playwright in interactive UI mode
npm run e2e:report # open the last HTML report
```

- **Unit tests** are plain `node:test` files (`src/**/*.test.ts`) run through `tsx` —
  no Jest/Vitest. Run a single file: `node --import tsx --test src/lib/insights.test.ts`;
  a single case: add `--test-name-pattern "<substring>"`.
- **E2E tests** (`e2e/*.spec.ts`, Playwright) run against a **production build**, not
  `next dev` — `playwright.config.ts`'s `webServer` runs `npm run build && npm run start`
  and reuses a server already on :3000 locally (so for a clean run, don't also have
  `npm run dev` going). `testDir` is scoped to `./e2e` so unit tests under `src/` aren't
  picked up. `e2e/auth.setup.ts` logs in once and saves a session cookie to
  `e2e/.auth/user.json`; the `chromium` project reuses it via `storageState`. The login
  password comes from `E2E_PASSWORD` (falls back to `APP_PASSWORD`) and must match the
  running server's `APP_PASSWORD`. Run one spec: `npx playwright test e2e/login.spec.ts`.
- On Windows, `prisma generate` can hit `EPERM` while the dev server holds a lock —
  stop the dev server (free port 3000) before generating.

Default login password (dev): `apexure` — change `APP_PASSWORD` in `.env`.

## Data

- Production/shared data lives in **Supabase Postgres**; connection strings are in
  `.env` (`DATABASE_URL` pooled, `DIRECT_URL` direct). `.env` and any local DB file
  are never committed. (Original dev used a SQLite file outside OneDrive — OneDrive
  locked the file and broke writes; the Supabase move superseded it.)
- Real 2026 data (Jan–June, ~213 pages) is in `prisma/import-data.ts`; the loader
  is `prisma/import-2026.ts` (`npx tsx prisma/import-2026.ts`). It connects via
  `DIRECT_URL` (the pgbouncer pool drops bulk imports — P1017) and **wipes and
  re-imports**: groups pages under client websites, maps platforms, builds the team,
  creates issues + QA certificates. Re-runnable.
- `prisma/seed.ts` is the original sample seed (Savvio demo) — superseded by the
  import; don't run both.
- Imported checklist items are all `NA` and there are 0 open issues — QA was tracked
  at the certificate-verdict level, not per-check. So itemized certificates show N/A
  until the team grades individual checks.

## Roadmap status

- [x] Phase 0–1: scaffold, design system, schema, auth, dashboard shell
- [x] Phase 2: full CRUD (client → project → page drill-down) + page detail
- [x] Phase 3: QA module (animated checklist editor + issue log) + team CRUD
- [ ] Phase 4: team assignment filtering (assignment done; add filter views)
- [ ] Phase 5: CSV importer (the monthly sheet) — skipped for now
- [x] Phase 6: monthly report dashboard (month picker, severity/platform charts, delivery table)
- [x] Phase 7: AI layer — URL-based QA agent (deterministic checks + Claude judgment)
- [x] Phase 8: deploy — Postgres (Supabase) + Vercel
- [x] Public QA certificate links + `/dashboard/insights` (key-free quality analytics)

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
