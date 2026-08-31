# CLAUDE.md — monorepo root

This repo holds the whole Apexure QA ecosystem. The app you're most likely
editing has its own instructions — read the nested file for whichever tree
you're working in:

- `apps/dashboard/CLAUDE.md` — Deliverables Dashboard (Next.js 16 + Prisma +
  Supabase). Most day-to-day work happens here.
- `apps/linkspy` — LinkSpy frontend (Next.js, NextAuth v4). Frontend contract
  and design standards: `docs/linkspy/`.
- `services/linkspy-api` — LinkSpy backend (FastAPI + Playwright). Tests:
  `cd services/linkspy-api && pytest tests/`. Deployed from its Dockerfile on
  Railway.
- `apps/shell` — the door page (signed handoff tokens to the other two apps).

Repo-wide invariants:

- **No root workspace.** Each app owns its `package.json` and lockfile; run
  commands from inside the app directory.
- **`prisma db push` and `db:reset` are BANNED** (ADR-001,
  `docs/decisions/001-prisma-migrate-and-additive-ddl.md`). Prisma Migrate
  only; verified `pg_dump` before any migration (`docs/runbooks/backup.md`).
  Both Supabase projects are free tier with **no point-in-time recovery**.
- **`INFRASTRUCTURE.md`** at the root is the single source of truth for env
  vars, secrets, flags, and cross-app wiring. Update it in the same PR as any
  deployment-config change.
- The spine/handoff contracts are duplicated per-language and guarded by
  checksums (`CONTRACT_CHECKSUM`, `HANDOFF_CHECKSUM`) — change them in every
  copy or not at all.
