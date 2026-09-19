# LinkSpy migrations

Plain SQL, run by hand in the Supabase SQL editor for the **LinkSpy** project,
after a verified `pg_dump` (`docs/runbooks/backup.md`). There is no migrator and
no ledger table, so **the file names are not a record of what has been applied**
— the database is.

`npm run db:deploy` does **not** apply these. That is `prisma migrate deploy`
against the *Dashboard* project, which is a different Supabase project with a
different schema. These files have no Prisma involvement at all.

## Checking what is applied

The database answers directly. For a table, `PGRST205` means it does not exist;
for a column, `42703`:

```bash
curl -s "$SUPABASE_URL/rest/v1/<table>?select=*&limit=1" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"
curl -s "$SUPABASE_URL/rest/v1/<table>?select=<column>&limit=1" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"
```

## Pending as of 2026-09-19

Verified against the live project, in the order to run them:

| File | Creates | What is silently disabled without it |
|---|---|---|
| `003_phase5_expected_tracking.sql` | `sites.expected_tracking` | the expected-vs-found tracking mismatch findings |
| `004_phase7_watchdog.sql` | `third_party_hosts`, `watchdog_alerts` | the third-party watchdog, which runs after **every** scan and discards its result |
| `005_phase4_active_optin.sql` | `active_form_optin` | per-site opt-in for active form submission |
| `009_client_resources.sql` | `client_resources` | the client portal's Resources panel |
| `026_sentinel_guards.sql` | `sentinel_status.guards` | five Overview cards: DNS, Email, Security, SEO, Accessibility |
| `027_scans_pages_scanned.sql` | `scans.pages_scanned` | the per-scan page count |

None of these fails loudly. Each one is caught by `_tables_missing` or
`_column_missing` in `database.py` and turned into a no-op, so the feature reads
"unavailable" and the compute is thrown away on every pass. See D15 in
`INFRASTRUCTURE.md`.

## Numbering

`018` was used twice: `018_attestations.sql` and what is now
`026_sentinel_guards.sql`. Nothing reads these numbers, so the collision was
harmless, but two files claiming the same slot makes "have we run 018?" an
unanswerable question. One number, one file.
