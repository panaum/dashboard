-- ════════════════════════════════════════════════════════════════════════════
-- LinkSpy — every pending migration, in order, in one transaction.
--
-- Verified against the live LinkSpy project on 2026-09-19: each object below
-- was confirmed ABSENT (PGRST205 for a table, 42703 for a column) before this
-- file was generated. Every statement is `if not exists`, so running it twice
-- changes nothing.
--
-- BEFORE RUNNING — take the dump. Free tier, no point-in-time recovery:
--
--     export LINKSPY_DIRECT_URL='postgresql://…@…pooler.supabase.com:5432/postgres'
--     export PGSSLMODE=require
--     pg_dump "$LINKSPY_DIRECT_URL" --no-owner --no-privileges --format=custom \
--       --file="linkspy-$(date +%Y%m%d-%H%M).dump"
--     pg_restore --list "linkspy-$(date +%Y%m%d-%H%M).dump" | head -40
--
-- The direct URL is port 5432, never 6543 — pgbouncer in transaction mode
-- breaks pg_dump. See docs/runbooks/backup.md.
--
-- `npm run db:deploy` does NOT apply this. That is prisma migrate deploy
-- against the DASHBOARD project, a different database. See migrations/README.md.
--
-- What each one turns back on:
--   003  sites.expected_tracking       expected-vs-found tracking mismatches
--   004  third_party_hosts, watchdog_alerts
--                                      the third-party watchdog, which runs
--                                      after EVERY scan and discards its result
--   005  active_form_optin             per-site opt-in for active form testing
--   009  client_resources              the client portal's Resources panel
--   026  sentinel_status.guards        DNS, Email, Security, SEO, Accessibility
--                                      cards — computed every pass, dropped
--   027  scans.pages_scanned           the per-scan page count, and with it the
--                                      tracking consistency card's denominator
--
-- AFTER RUNNING: force a sentinel pass so the cards fill without waiting for
-- the 24-hour timer (which restarts on every deploy — see D16).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 003_phase5_expected_tracking.sql
-- ───────────────────────────────────────────────────────────────
-- Phase 5: optional per-site expected tracking ids.
--
-- Additive only. One nullable jsonb column, no renames, no drops. Safe to run
-- more than once.
--
-- Holds a site's own GA4 / Meta Pixel / GTM ids, e.g.
--   {"ga4": "G-ABC123", "meta_pixel": "1234567890", "gtm": "GTM-ABCDE"}
-- When set, the tracking audit flags a scanned page whose ids do not match —
-- a mis-pasted snippet sending data to the wrong account. When null, that one
-- check is skipped; every other tracking check runs regardless.
--
-- This column lives on the existing `sites` table, which already has RLS
-- policies from the initial schema, so no new policy is required. (If your
-- project uses the service_role key from the backend, RLS is bypassed anyway.)
--
-- Apply with: Supabase SQL editor, or `psql -f` against the project database.

alter table sites
    add column if not exists expected_tracking jsonb;

-- ───────────────────────────────────────────────────────────────
-- 004_phase7_watchdog.sql
-- ───────────────────────────────────────────────────────────────
-- Phase 7: third-party watchdog.
--
-- Additive only. Two new tables, no changes to existing ones. Safe to run more
-- than once.
--
-- RLS NOTE (this bit us before): the LinkSpy backend connects with the Supabase
-- SERVICE_ROLE key, which BYPASSES row-level security. The existing tables
-- (sites, scans, scan_snapshots, findings) define no RLS policies for the same
-- reason. These two tables follow that pattern. If you later enable RLS on this
-- project, you must add permissive policies (or keep using service_role), or
-- every read/write from the backend will silently return nothing.
--
-- Apply with: Supabase SQL editor, or `psql -f` against the project database.

-- One row per (third-party host, site). The inventory the watchdog aggregates.
create table if not exists third_party_hosts (
    id              uuid primary key default gen_random_uuid(),
    host            text not null,
    site_id         uuid not null references sites (id) on delete cascade,
    resource_type   text,                       -- script | iframe | form_action
    last_status     text not null default 'unknown',   -- up | down | unknown
    last_status_code integer,
    sample_url      text,
    last_checked_at timestamptz not null default now(),
    unique (host, site_id)
);

create index if not exists third_party_hosts_host_idx
    on third_party_hosts (host);

create index if not exists third_party_hosts_down_idx
    on third_party_hosts (host) where last_status = 'down';

-- One row per host we have alerted about, for the 24h dedupe. A host outage is
-- announced once, not once per site and not again within the window.
create table if not exists watchdog_alerts (
    host            text primary key,
    last_alerted_at timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────
-- 005_phase4_active_optin.sql
-- ───────────────────────────────────────────────────────────────
-- Phase 4: opt-in active form testing.
--
-- Additive only. One new table. Safe to run more than once.
--
-- A form may be submitted by the active tester ONLY if a row here has
-- enabled = true for it. This is on top of the global ACTIVE_FORM_TESTING flag
-- (an environment variable, default off). Both must be true; there is no way to
-- enable submission for a form the user has not explicitly turned on.
--
-- RLS NOTE (same as the other Phase tables): the backend uses the service_role
-- key, which bypasses RLS. The existing tables define no policies. If you enable
-- RLS on this project, add permissive policies or keep using service_role.
--
-- Apply with: Supabase SQL editor, or `psql -f` against the project database.

create table if not exists active_form_optin (
    id          uuid primary key default gen_random_uuid(),
    site_id     uuid not null references sites (id) on delete cascade,
    form_key    text not null,              -- stable identifier for the form
    test_email  text,                       -- filterable qa+linkspy@ address
    enabled     boolean not null default false,
    updated_at  timestamptz not null default now(),
    unique (site_id, form_key)
);

create index if not exists active_form_optin_site_idx
    on active_form_optin (site_id);

-- ───────────────────────────────────────────────────────────────
-- 009_client_resources.sql
-- ───────────────────────────────────────────────────────────────
-- Client portal: per-client Resources (agency-managed labeled links — the QA
-- certificate, staging URL, Figma, GA dashboard). visible=true shows it in the
-- client portal. Permissive RLS (the app enforces authorization).
create table if not exists client_resources (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references clients (id) on delete cascade,
    workspace_id uuid references workspaces (id) on delete cascade,
    title text not null,
    url text not null,
    visible boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists client_resources_client_idx on client_resources (client_id);

alter table client_resources enable row level security;
do $$ begin
    if not exists (select 1 from pg_policies where schemaname='public' and tablename='client_resources' and policyname='client_resources_all') then
        create policy client_resources_all on client_resources for all to public using (true) with check (true);
    end if;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 026_sentinel_guards.sql
-- ───────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────
-- 027_scans_pages_scanned.sql
-- ───────────────────────────────────────────────────────────────
-- scans.pages_scanned — the column database._insert_scan has been dropping.
--
-- _OPTIONAL_SCAN_COLUMNS exists because inserting a column the schema lacks
-- makes PostgREST reject the whole row, which used to throw away every scan
-- silently. The retry keeps the scan. What it does not do is tell anyone the
-- column is missing, so every site scan since has recorded its links and lost
-- its page count — which is why "pages scanned" cannot be read back from the
-- scans table and has to be derived from results_json.
--
-- Run in the Supabase SQL editor for the LinkSpy project, after a pg_dump
-- (docs/runbooks/backup.md). Idempotent.

alter table scans
    add column if not exists pages_scanned integer;

comment on column scans.pages_scanned is
    'How many pages this scan actually read. Null for rows written before the column existed.';

commit;
