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
