-- Sentinel guards: the five checks beside SSL / domain / indexability / uptime
-- (sentinel_guards.py) — DNS drift and registrar, email authentication,
-- security posture, SEO essentials, accessibility essentials — stored as one
-- JSON document per site on the sentinel row, with the previous DNS snapshot
-- inside it so drift is change-only. One column, so no guard needs a
-- migration of its own; the code tolerates the column's absence (the cards
-- read "unavailable") until this is applied.
--
-- Run in the Supabase SQL editor for the LinkSpy project, after a pg_dump
-- (docs/runbooks/backup.md). Idempotent.

alter table sentinel_status
    add column if not exists guards jsonb not null default '{}'::jsonb;

comment on column sentinel_status.guards is
    'sentinel_guards.py: {domain, domain_expiry, dns:{snapshot,registrar,last_drift}, email, security, seo, a11y}, replaced whole on every sentinel pass';
