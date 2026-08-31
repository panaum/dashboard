# Apexure QA ecosystem

Monorepo for the three apps and one service that make up Apexure's QA
ecosystem. Merged from `panaum/dashboard`, `panaum/brokenlinkchecker`, and
`panaum/QA-Ecosystem` on 2026-08-31 with full git history (use
`git log --follow` across the moves).

| Path | What | Deployed on |
|---|---|---|
| `apps/dashboard` | Deliverables Dashboard — client/project/page tracking + QA certificates (Next.js 16, Prisma, Supabase) | Vercel `dashboard` |
| `apps/linkspy` | LinkSpy frontend (Next.js, NextAuth v4) | Vercel `brokenlinkchecker` |
| `services/linkspy-api` | LinkSpy backend — scans, monitoring, jobs (FastAPI + Playwright) | Railway `brokenlinkchecker` |
| `apps/shell` | QA ecosystem shell — the door page with signed handoffs | Vercel `qa-ecosystem` |
| `apps/linkspy-extension` | LinkSpy browser extension | — |
| `packages/qa-tokens` | Shared design tokens | — |

Each app keeps its own `package.json`, lockfile, and commands — there is no
root workspace; `cd` into the app you're working on. Hosting projects each
point at their subdirectory via Vercel's Root Directory / Railway's root
setting.

Ecosystem-wide references live at the root:

- **`INFRASTRUCTURE.md`** — every deployment surface, env var, shared secret,
  and feature flag, plus runbooks. The single copy (the old two-repo mirror
  regime is over).
- **`docs/decisions/`** — ADRs. ADR-001 bans `prisma db push` / `db:reset`;
  schema changes go through Prisma Migrate with a verified `pg_dump` first.
- **`docs/runbooks/`** — backups, rotation, drains.
- **`docs/linkspy/`** — LinkSpy's architecture, design standards, and
  frontend contract.
