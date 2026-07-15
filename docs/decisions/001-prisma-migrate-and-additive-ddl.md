# ADR-001 — Prisma Migrate (not `db push`) + additive-only DDL + dump-before-migrate

**Status:** accepted
**Date:** 2026-07-15
**Deciders:** Anaum / Waseem / Malik (federation working group)
**Supersedes:** none · **Related:** ARCHITECTURE.md v7 §8.5 (change budget), Data-Safety Constitution

---

## Context

The Deliverables Dashboard schema has been managed with **`prisma db push`**
against a **free-tier Supabase Postgres (no point-in-time recovery)** holding
~231 pages of irreplaceable QA history. `db push`:

- applies schema changes with **no migration history** and **no reversibility
  record**;
- silently reconciles drift (it can DROP/alter to match the schema model);
- is paired in this repo with `db:reset` = `prisma db push --force-reset`,
  which **drops the entire database** — one fat-fingered script away from
  total loss, with no PITR to recover from.

There is no undo button on this database. The only recovery is a backup we
took by hand.

## Decision

1. **`prisma db push` is BANNED**, along with `--force-reset`. A mechanical
   guard (`scripts/guard-no-db-push.mjs`, wired as `prebuild` and `guard:db`)
   fails any build that reintroduces either into `package.json` scripts.
2. **Schema changes go through Prisma Migrate**: `db:migrate`
   (`prisma migrate dev`) in development, `db:deploy` (`prisma migrate deploy`)
   in production. The current production schema was **baselined** as migration
   `0_init` and marked applied via `prisma migrate resolve --applied 0_init` —
   **zero DDL executed against production** (verified drift-free first).
3. **Additive-only DDL.** No `DROP`, no rename, no type-narrowing. A rename =
   add new column + backfill + deprecate; the old column is retained one full
   release cycle. Every migration file ends with `-- REVERSIBILITY:` and
   `-- DATA AT RISK:` footers; anything other than "none, additive only"
   requires its own ADR before it may be written.
4. **Dump-before-migrate.** Before ANY migration on EITHER production database,
   a dated `pg_dump` (custom format) is taken to `C:\backups` (never inside
   OneDrive), verified (`pg_restore --list` + non-zero size), and its filename
   recorded in the migration's commit / PR description.

## Baseline evidence (this gate)

- **Backup of record:** `C:\backups\qa-dashboard-20260715-224052.dump`
  (424,516 bytes; `pg_restore --list` exit 0; 436 entries; `Page`,
  `QACheckItem`, `QACertificate`, `Client`, `Project`, `TeamMember`, `Issue`
  all present).
- **Drift check** (`prisma migrate diff` prod → `schema.prisma`): **empty** —
  production already matched the schema exactly, so baselining is honest.
- **`prisma migrate status`:** "Database schema is up to date!"

## Consequences

**Positive:** every future schema change is reviewable, reversible-by-record,
and gated behind a verified dump; the accidental-wipe foot-gun is removed
mechanically, not by discipline alone; migration history becomes the audit
trail §8.5 asks for on registry/ledger changes.

**Costs / trade-offs:** slightly more ceremony per change (write a migration,
take a dump) — deliberately so, proportional to permanence. Developers must
run `db:migrate` locally instead of `db push`; the muscle memory changes once.

**Follow-ups:** the `package.json#prisma` seed config is deprecated in Prisma 7
(migrate to `prisma.config.ts`) — tracked, not urgent. A future
explicitly-ADR'd cleanup may remove any deploy-probe objects (drops require an
ADR by rule 1).
