# INFRASTRUCTURE.md — Apexure QA ecosystem

The definitive map of every deployment surface, environment variable, shared
secret and feature flag across the three repos that make up the QA ecosystem.

**Everything here is derived from code**, by grepping every `process.env.*` /
`os.getenv(...)` / `os.environ[...]` reference in all three repositories and
reading the surrounding logic. Where the code disagrees with what we believed
was true, the code wins and the disagreement is recorded in
[Discrepancies found](#discrepancies-found).

**No real secret values appear in this file** — placeholders only.

| | |
|---|---|
| **Repo** | `panaum/dashboard` — monorepo since 2026-08-31: `apps/dashboard` (Deliverables Dashboard), `apps/linkspy` (LinkSpy frontend), `services/linkspy-api` (LinkSpy backend), `apps/shell` (QA ecosystem shell) |
| **Surfaces** | 1 Railway service, 3 Vercel projects, 2 Supabase projects |
| **Last derived** | 2026-07-20 |
| **Copies** | this file, at the monorepo root, is the only copy — the byte-identical two-repo mirror regime ended with the monorepo merge |

**Path note:** code references below predate the monorepo and use the old
per-repo paths. Read `frontend/…` as `apps/linkspy/…`, `backend/…` as
`services/linkspy-api/…`, the Dashboard's `src/…` as `apps/dashboard/src/…`,
and shell paths as `apps/shell/…`.

---

## Topology

```
                       ┌──────────────────────────────┐
                       │  Vercel: qa-ecosystem        │
                       │  (apexure-shell)             │
                       │  qa-ecosystem-2i6v.vercel.app│
                       └───────────┬──────────────────┘
                        /go/dashboard   /go/linkspy
                       (signed handoff token, TTL ≤300s)
                           │                   │
              ┌────────────▼─────┐   ┌─────────▼──────────────┐
              │ Vercel: dashboard│   │ Vercel:brokenlinkchecker│
              │ (Next.js 16)     │   │ (Next.js frontend)     │
              └────┬────────┬────┘   └────────┬───────────────┘
                   │        │                 │ every /api/* proxy
                   │        │                 │ (BACKEND_URL)
                   │        │                 ▼
                   │        │        ┌────────────────────────┐
                   │        └───────►│ Railway:               │
                   │   LINKSPY_API_  │ brokenlinkchecker      │
                   │   KEY (Bearer)  │ (FastAPI + Playwright) │
                   │                 └────────┬───────────────┘
                   │  spine events (HMAC)              │
                   │  ◄──────────────────────────────► │
                   ▼                                   ▼
        ┌────────────────────┐            ┌────────────────────┐
        │ Supabase: QA /     │            │ Supabase: LinkSpy  │
        │ Deliverables       │            │                    │
        └────────────────────┘            └────────────────────┘
```

---

## Discrepancies found

Ordered by operational severity. Each is a place where the code contradicts the
assumed state of the system.

### D1 — `DASHBOARD_BRIDGE_KEY` points at an endpoint that does not exist ✅ RESOLVED

**Resolved 2026-08-05.** The Dashboard now serves
`GET /api/registry-bridge/delivery` (`src/app/api/registry-bridge/delivery/route.ts`,
commit `db85693`), which validates `DASHBOARD_BRIDGE_KEY` with a timing-safe
compare. Both vars are live and required for the Delivery panel and the
delivery-presence line. The original finding is kept below for the record.

---

LinkSpy's frontend calls the Dashboard at
`{DASHBOARD_BRIDGE_URL}/api/registry-bridge/delivery?registry_site_id=…`
with `Authorization: Bearer {DASHBOARD_BRIDGE_KEY}`
(`frontend/app/api/delivery/route.ts:35-46`).

**The Dashboard has no `/api/registry-bridge/*` route.** Its complete API
surface is `/api/registry/clients`, `/api/registry/clients/[clientId]/sites`,
`/api/registry/prefills/refresh`, `/api/spine/drain`, `/api/spine/health`,
`/api/spine/inbox`, `/api/spine/outbox-status`. `DASHBOARD_BRIDGE_KEY` is read
nowhere in the Dashboard repo, and nowhere in the LinkSpy *backend* either.

Consequence: `/api/delivery` always falls into its catch and returns HTTP 200
`{ unavailable: true }` (or stale cache). It fails **silently and successfully**,
so nothing alerts. Either build the receiving route or delete the two vars.

### D2 — LinkSpy backend has no drain HTTP endpoint; there is no cron-job.org drain ⚠️

The expected "cron-job.org drain job" does not exist on the backend.
`spine_outbox_drain` is a **job-queue handler** (`backend/spine.py:86`), not a
route. It is enqueued internally by APScheduler every 5 minutes
(`backend/main.py:290-299`). Nothing in FastAPI is designed to be poked by an
external cron.

The only external-cron surface that actually exists is:
- **Dashboard** `/api/spine/drain` — cron-job.org, every 5 min. *(Until
  2026-07-20 this was a daily Vercel cron; that entry has been removed from
  `vercel.json` in favour of the external job.)*

### D3 — LinkSpy's cron route was unreachable; it has been deleted ✅

**Confirmed in production on 2026-09-19, then resolved by deleting the route.**

`frontend/middleware.ts`'s matcher excludes `login|handoff|portal|reports|
attest|api/auth|api/slack|api/portal|api/reports|api/attest|api/attestations|
_next/...`. **`api/cron` and `api/webhooks` are not in that exclusion list**, so
the auth wall ran first and 307'd to `/login` before any handler executed.
Probed with `GET` (the route exported only `POST`, so a GET could not trigger a
scan but still discriminated: 405 if the handler were reached):

| Path | Result |
|---|---|
| `/login`, `/api/auth/providers` (excluded) | 200 — controls: the exclusion list works |
| `/dashboard` (protected) | 307 → `/login?callbackUrl=%2Fdashboard` |
| `/api/cron/auto-scan` | **307** → `/login?callbackUrl=%2Fapi%2Fcron%2Fauto-scan` |
| `/api/webhooks/github` | **307** → same |

The `callbackUrl` is the middleware's own construction, so the redirect is
unambiguously the auth wall and not Next's routing.

**Automated scanning never depended on it.** The LinkSpy *backend* runs its own
in-process scheduler on Railway (`MonitorScheduler`, one interval job per site
with `monitoring_enabled`, at that site's cadence, via `run_monitored_scan`),
alongside the daily sentinel, 5-minute uptime, ads verification, fragility,
perf and tracer jobs. The frontend route duplicated that logic worse — it
re-derived `freq`/`last_scanned_at` and poked `/scan` with no auth — so it was
deleted rather than unblocked: a second scheduler racing the backend's would
double-scan client sites. **If an external heartbeat is ever wanted, point it
at the backend, not the frontend.**

⚠️ **`/api/webhooks/github` is still dead.** Same interception, deliberately
left alone because self-heal is opt-in and default-off. Anyone wiring self-heal
up must add `api/webhooks` to the matcher's exclusion list first, or GitHub's
deliveries will silently collect 307s and nothing will ever fire.

### D4 — `PORTAL_ENFORCE` unset means the LinkSpy backend has no authorization at all ⚠️

`backend/auth.py:30` — when `PORTAL_ENFORCE` is falsy, every `require_*`
dependency returns `_BYPASS` (`auth.py:24,112`) = `role: "owner",
enforced: False`. Combined with the **service-role** Supabase key the backend is
built around (`auth.py:10-11`: *"authorization is enforced HERE… RLS is
deny-by-default defense-in-depth, not this"*), an unset `PORTAL_ENFORCE` means
unauthenticated cross-tenant read/write access to every tenant.

This is the single highest-stakes variable in the ecosystem. Confirm its value
on Railway.

### D5 — The shell's auth wall is disabled in committed code ⚠️

`apexure-shell/middleware.ts` is a pass-through (commit `abaf62d`, *"chore:
temporarily disable auth wall"*). The NextAuth config and the `@apexure.com`
domain gate in `lib/auth.ts:21-24` are intact but **inactive**. `/go/dashboard`
and `/go/linkspy` have no session check of their own, so anyone on the public
internet can mint a valid handoff token.

**Mitigation confirmed by reading both verifiers:** the token is friction-removal,
not auth. Dashboard's `/handoff` (`src/app/handoff/route.ts`) forwards only if
the browser already holds the `session` cookie, else redirects to `/login`.
LinkSpy's `/handoff` behaves the same against its NextAuth cookies. So a stolen
token grants nothing — but the shell's homepage copy *"Pick a door — you're
already signed in"* and its README are now false for anonymous visitors.

### D6 — `JOBS_MONITORING_LIVE=1` breaks monitoring rather than enabling it

`backend/jobs.py:144-155`: when the flag is `"1"`, `_monitoring_scan` skips the
shadow branch and immediately hits
`raise RuntimeError("monitoring_scan live path is not enabled yet (shadow only)")`.
Turning this on makes every `monitoring_scan` job **fail**. It must stay unset.

### D7 — `SPINE_SECRET` without `JOBS_SHADOW=1` silently queues work forever

The spine enqueue block is gated on `if os.getenv("SPINE_SECRET"):`
(`main.py:278`), but the worker that *executes* those jobs only starts under
`JOBS_SHADOW == "1"` (`main.py:262`). Set the secret without the flag and drain,
heartbeat and reconcile jobs accumulate in the `jobs` table and never run — with
no error anywhere.

### D8 — Two incompatible truthiness idioms for flags

- **Strict `== "1"`** — `JOBS_SHADOW`, `JOBS_MONITORING_LIVE`, `FLYWHEEL`,
  `SPINE_CONSUME`, `AUTO_ENROLL`, and the Dashboard's `SPINE_EMIT`.
- **Lenient `in ("1","true","yes","on")`** — `PORTAL_ENFORCE` (`auth.py:30`),
  `TRACER_ENABLED`, `ACTIVE_FORM_TESTING`, `SELF_HEAL`.

`PORTAL_ENFORCE=on` works; `FLYWHEEL=on` silently does nothing. Always use `1`.

### D9 — `DIRECT_URL` is the pooler in session mode, not the direct host

`docs/runbooks/backup.md:21-23,58-60` describes dumping against "the DIRECT
connection… not the pooled one", implying `db.<ref>.supabase.co`. In reality
**both** Dashboard URLs use the pooler host, differing only by port:

| Var | Host | Port | Mode |
|---|---|---|---|
| `DATABASE_URL` | `aws-1-ap-southeast-2.pooler.supabase.com` | 6543 | transaction (pgbouncer) |
| `DIRECT_URL` | `aws-1-ap-southeast-2.pooler.supabase.com` | 5432 | **session** |

This is correct and necessary — the true direct host is IPv6-only, and the
pooler is the IPv4 path. The functional advice (use 5432, never 6543) still
holds; the *wording* in the runbook is misleading. Region `ap-southeast-2`
(Sydney) matches `vercel.json`'s `syd1` pin.

#### D9 addendum (2026-09-20) — `DIRECT_URL` needs `?sslmode=require` for Prisma

`prisma migrate deploy` for the boards migration failed with **P1001, cannot
reach database server** against the same pooler host that `psql` connected to
in the same second. The difference was SSL: `psql` took it from the
`PGSSLMODE=require` environment variable, which Prisma's engine does not read.
With `?sslmode=require&connect_timeout=30` appended to `DIRECT_URL`, Prisma
connected in ten seconds and the migration applied cleanly.

So the URL in Railway/Vercel and in any local `.env` should carry the
parameter itself, rather than relying on an environment variable only one
client honours. Without it the failure mode is a ten-minute hang followed by
an error that reads like an outage, on a host that is up.

### D10 — Dead variables

| Var | Surface | Why dead |
|---|---|---|
| `AUTH_SECRET` | Vercel brokenlinkchecker | NextAuth **v5** name; that app is v4 and reads `NEXTAUTH_SECRET`. Inert if set. |
| `AUTH_TRUST_HOST` | Vercel brokenlinkchecker | v5-only. Never read. |
| `PORT` | Railway | Consumed by the shell in `Dockerfile:7` (`--port $PORT`), never by Python. It is also the *only* var `README.md:58` documents for the backend. |
| `BOARD_URL` | Vercel qa-ecosystem | Not dead — deliberate forward-looking placeholder for the third door (`README.md:51-54`). Setting it today has no effect. |

### D11 — Documentation gaps

- **Dashboard `.env.example` omits three vars its code reads**: `SPINE_SECRET`,
  `SPINE_EMIT`, `CRON_SECRET`.
- **LinkSpy backend `README.md` documents only `PORT`** — the one var Python
  never reads. All 21 backend vars are otherwise undocumented as deployment config.
- **LinkSpy frontend has no `.env.example` and no `vercel.json`** — all 12 of its
  vars are undocumented in-repo.
- `src/lib/handoff-contract.ts`'s header comment in the **Dashboard** repo claims
  *"LinkSpy: frontend/lib/handoff-contract.ts (this file)"* — copy-paste artifact
  from the mirrored file.

### D12 — Inconsistent constant-time comparison

`handoff-contract.ts` and `spine-contract` (both languages) use
`timingSafeEqual` / `hmac.compare_digest`. But
`frontend/app/api/webhooks/github/route.ts:20` and
`frontend/app/api/cron/auto-scan/route.ts:9` use plain `!==` string compares.
Minor, but inconsistent with the rest of the codebase.

### D13 — Endpoints that fail open

| Endpoint | Behaviour when its secret is unset |
|---|---|
| Dashboard `/api/spine/drain` | `authorized()` returns `true` — *"not yet configured → allow (pre-activation)"* |
| Dashboard `/api/spine/outbox-status` | Auth check is `if (secret && …)` — unset ⇒ open |
| LinkSpy `/api/cron/auto-scan` | Guard is `if (cronSecret && …)` — unset ⇒ public scan trigger |
| LinkSpy backend (all routes) | `PORTAL_ENFORCE` unset ⇒ `_BYPASS` (see D4) |

Dashboard `/api/spine/health` has **no auth at all** by design, and exposes
`SPINE_EMIT` state plus outbox counts.

### D14 — `/api/*` was never covered by the proxy; four routes were open ✅ RESOLVED

**Found and fixed 2026-08-27.**

`src/proxy.ts` declares `matcher: ["/dashboard/:path*"]`. Nothing under `/api`
has ever matched it, so the lightweight cookie-presence check never applied to
any API route. (That check is also presence-only — it reads
`req.cookies.has("session")` and never verifies the signature — so widening the
matcher would not have been sufficient on its own.)

Four internal routes carried no credential of their own and were therefore
reachable without a session. Verified against production by unauthenticated
`curl` on 2026-08-27:

| Route | Observed | Exposed |
|---|---|---|
| `GET /api/registry/clients` | **200** | LinkSpy registry client ids + names (3 rows at the time) |
| `GET /api/registry/clients/{id}/sites` | **200** | LinkSpy site ids + URLs (2 rows at the time) |
| `GET /api/presence/clients` | **200** `{"enabled":false}` | nothing — `PRESENCE_CHIPS` is unset on the Dashboard |
| `POST /api/registry/prefills/refresh` | *not invoked* | code path relays to LinkSpy's rate-limited battery using `LINKSPY_API_KEY` |

Scope of what was actually shown:

- The presence route was protected **only by its feature flag being off**. With
  `PRESENCE_CHIPS=1` it would have returned per-client worst-state and tooltip
  text to anonymous callers. Flag-off was doing the work auth should have done.
- The prefills route is a **POST**; it was confirmed unguarded by reading the
  handler, not by calling it, so no LinkSpy work was triggered during the audit.
- `LINKSPY_API_KEY` itself was **not** exposed. All four are server-side proxies
  and `src/lib/registry.ts` remains `import "server-only"`. What leaked was the
  registry metadata those proxies return.
- Logs were not reviewed, so whether any of this was ever reached by a third
  party is **unknown, not ruled out**.

The presence handler's comment previously read *"Session-guarded like every other
Dashboard route (middleware)"*. That was false in two ways — the middleware did
not cover the route, and it would not have verified the signature if it had. The
comment has been corrected to state that the guard lives in the handler.

**Fix.** `requireApiAuth()` (`src/lib/auth.ts`) does the real check — it calls
the same timing-safe `isValid()` used by `requireAuth`, and returns `401` JSON
rather than redirecting, since a redirect to an HTML login page is the wrong
answer to a `fetch()`. All four handlers call it before touching
`LINKSPY_API_KEY` or the database. The `proxy.ts` matcher was deliberately left
unchanged: presence-checking middleware is not a substitute for signature
verification, and the guard belongs where the data is served.

**Regression cover.** `src/app/api/api-auth.isolation.test.ts` walks
`src/app/api` and fails on any `route.ts` not listed in one of three buckets —
session-guarded (`requireApiAuth`), service-guarded (`DASHBOARD_BRIDGE_KEY`,
`SPINE_SECRET`, `CRON_SECRET`), or public-by-design
(`/api/living-certificate/[shareId]`, `/api/spine/health`). A new API route now
fails the suite until its auth is declared, so protection can no longer be
assumed by inheritance. The test also asserts the guard precedes any use of
`LINKSPY_API_KEY` / `db.`, that `requireApiAuth` returns 401 rather than
redirecting, and that the `proxy.ts` matcher still does not claim to cover
`/api`.

---

### D15 — The analytics guard covered one outbound path out of nine; every scan fired the client's tracking ✅ RESOLVED

**Found and fixed 2026-09-19. Checker in #151, the nine outbound paths in #154.**

`scraper._block_non_get` aborts analytics requests *inside Playwright*, because
firing a pixel while auditing logs a visitor who does not exist. That guard was
never wrong; it was never complete. `collect_resources` hands every URL it finds
to `checker.check_single`, which issues its own `httpx` GET with a browser
user-agent and the client's own page as `Referer` — a second outbound path, with
no guard on it at all.

A Meta Pixel's `<noscript>` fallback is an `<img>` pointing at a collection
endpoint. So is a GTM `<noscript>` iframe, and a Google Ads conversion pixel.
The scan fetched all of them and recorded each as a healthy link (`ok`/`ok`).

**Root cause, stated generally: whenever there are two places that make
requests, a guard on one is a guard on neither.** The guard belongs at every
outbound path, or behind a choke point they all share.

#### Measured contamination

Counted from `scans.results_json` in LinkSpy Supabase, across every scan since
resource checking shipped (`77ef699`, 2026-07-09). Not sampled — every row.

apexure.com — 1,635 scans, 2026-07-10 → 2026-09-19 (~23/day, hourly under
monitoring):

| Endpoint | Requests | What the fetch does |
|---|---|---|
| `facebook.com/tr?id=1105630533445518&ev=PageView` | **1,635** | records a PageView on the pixel |
| `googleads.g.doubleclick.net/pagead/viewthroughconversion/700482601/` | **3,173** | records a view-through conversion impression |
| `googletagmanager.com/ns.html?id=GTM-P593C44` | **1,635** | loads the container's noscript tags |
| `connect.facebook.net/signals/config/1105630533445518` | 1,635 | pixel config JS — records nothing; refused as a precaution |
| **Hit-recording total** | **6,443** | |

fautons.com — 1,666 scans, same window:

| Endpoint | Requests | What the fetch does |
|---|---|---|
| `googletagmanager.com/ns.html?id=GTM-PDMPQLJH` | **1,666** | loads the container's noscript tags |

No other site is affected: of 8 site rows only these two are monitored, and the
most recent scan of every other site contains no tracking endpoint. The phantom
requests all originate from the Railway egress IP with a browser user-agent, so
in the client's reporting they are not distinguishable from real visits.

**The real-traffic denominator is not held anywhere in our data** —
`consent_sessions`, `tracer_runs` and `ad_destinations` are empty for both
sites. It has to be read from Meta Events Manager (pixel `1105630533445518`),
Google Ads (conversion `700482601`) and the two GTM containers, over
2026-07-10 → 2026-09-19.

Separately, `uptime_pings` holds 19,767 rows for apexure and 19,790 for fautons
over the same window. Those are plain `httpx` GETs of the homepage with no
JavaScript, so they fire no tags — but they do appear in server logs and in any
server-side or edge analytics.

#### Fix (#151)

`beacons.py` refuses collector endpoints at `check_single`'s GET, the single
place the checker makes an outbound request. Refused URLs report as
`not_requested` / `unverifiable` — distinct from `blocked` (their host refused
us) and from `ok` (we looked and it was fine). It is deliberately narrower than
the render-time list, which matches the whole URL loosely; the checker also sees
`<a href>`, so a client's own Facebook page link must still be checked. Tag
*scripts* stay checked, because fetching `.js` records nothing and a container
that 404s means their analytics is not running at all. `collect_resources` also
stops collecting `<img>` inside `<noscript>` and 1×1 pixels.

#### Audit: every path that points a browser or a fetch at a client URL

**Corrected 2026-09-19, later the same day.** The first version of this audit
said the scan's own render was covered by `_block_non_get`. It was not. That
route is armed inside `_reveal_forms`, only while clicking things open, and the
page LOAD at `scraper.py` had no guard at all. Counting
`main._capture_screenshot`, there were nine outbound paths, not six.

| Path | Kind | Before | Now |
|---|---|---|---|
| `checker.check_single` | httpx GET | `beacons.py` (#151) | unchanged |
| `ads_guard`, `fix_verify` | httpx via `check_single` | inherits #151 | unchanged |
| `scraper._scrape_sync` | render | **guard armed only during click-reveal, not for the page load** | `guarded_context` |
| `responsive_engine` | render | own `COLLECTOR_RX` route | `guarded_context`, one predicate |
| `main._capture_screenshot` | render | **none** — the seventh place | `guarded_context` |
| `pagecheck_engine`, `attribution` | render | **none**, and they carry UTM + click ids | `guarded_context` |
| `active_submission_exec` | render | **none**, via `browser.new_page()` | `guarded_context` |
| `lead_contracts` | render | **none** | `guarded_context_async` |
| `xray` | render | **none** | `guarded_context` |
| `consent_render` | render | none, by design | `allow_collectors="<reason>"`, explicit |
| `sentinel` (uptime) | httpx GET | n/a | homepage only, no JS, fires no tags |
| `form_audit`, `suggester`, `sitemap` | httpx GET | n/a | form actions / candidates / `sitemap.xml` |

#### What a render actually fired

Measured by rendering the page with the loader scripts allowed, so each tag
initialised and attempted its real beacon, and aborting only the endpoints that
record a hit. Nothing reached the client's analytics during the measurement.

| Site | Hit-recording requests per render |
|---|---|
| apexure.com | **10** |
| fautons.com | 0 — its container fires nothing |

apexure.com's ten are two Google Ads view-through conversions on `700482601`,
four GA4 and Ads collect hits (`analytics.google.com/g/collect`,
`google-analytics.com/j/collect`, `stats.g.doubleclick.net/g/collect`,
`www.google.com/g/collect`), two `ad.doubleclick.net/ccm/s/collect`, one Meta
`/tr` PageView, and one `heapanalytics.com/h`.

Unlike the checker's figures above, the render total is **arithmetic, not a
count**: render requests are not stored, so 10 × 1,635 scans ≈ 16,000 is a
multiplication that assumes the tag setup held for ten weeks. The per-render
figure is measured; the multiplier is the scan count. It roughly **doubles** the
Google Ads view-through number, to about 6,400 including the checker's 3,173.

#### The structural fix

`outbound.py` is now the only place a Playwright context is created. It arms the
collector route on every one, using `beacons.beacon_reason` — the same predicate
the checker uses, so the two outbound paths cannot drift apart. Tag scripts
still load, because a render that blocks `gtm.js` is not measuring the client's
page; only the endpoints that record a hit are aborted.

`tests/test_outbound_guard.py` fails the build if any module calls
`.new_context(` or `browser.new_page()` directly, if a caller omits `purpose=`,
or if anything but `consent_render.py` passes `allow_collectors`. That argument
takes a written reason rather than a boolean, so the justification lives at the
call site and an exemption is reviewed rather than inherited.

Every context keeps a ledger of what it refused and what got through anyway.
The leak list earned itself immediately: on the first real run it showed
`heapanalytics.com/h` being served four times. A **page** route takes priority
over its **context** route, so `_block_non_get` calling `route.continue_()`
during click-reveal was waving requests straight past the collector guard. It
now calls `route.fallback()`, which hands the request down instead of answering
it. After that change the same run blocked 18 and leaked none.

Two hand-kept collector lists became one. `responsive_engine.COLLECTORS` is
retained only for excluding tracking pixels from broken-image detection, and a
test asserts every token it holds is still refused by the shared predicate, so
unifying them cannot become a quiet downgrade.

---

### D16 — Five migrations were unapplied, and every one failed silently ✅ RESOLVED

**Found and applied 2026-09-19.** Verified `pg_dump` first (29 MB custom-format,
727 TOC entries, 79 `TABLE DATA` entries, `pg_restore --list` clean), kept at
`~/linkspy-backups/linkspy-20260919-195130.dump`. Applied through the session
pooler on 5432 against project `uyvjqaggkqotqcqjwxgm`, one transaction per file,
ordered by what was being discarded: `004` first because the watchdog throws a
result away after every scan, then `026` because five cards were computed and
dropped every pass, then `003`, `005`, `009`, `027`.

All seven objects confirmed present afterwards from `pg_class` and
`information_schema`. A forced sentinel pass over all eight sites completed
8 of 8, and every Overview card now carries data — no site reports
"unavailable" on any of the nine.

What the guards had been computing and discarding, visible on the first pass:

| Site | Was being thrown away |
|---|---|
| apexure.com | HSTS missing, CSP missing, three more header notices, a 200-character meta description, one skipped heading level |
| fautons.com | SPF **none**, DMARC `p=none`, 2 of 5 form fields without a label |
| dev.apexure.org | 2 email faults, 1 security, 1 accessibility, search visibility at risk |

`scans.pages_scanned` is null on every existing row, so the tenth card reads
"unavailable" until the next scan writes one. That is the column doing its job,
not a fault.

`sentinel_status.guards` was known to be missing. Checking the rest of the
LinkSpy schema against `migrations/*.sql` found four more, verified live:

| Migration | Missing | Silently disabled |
|---|---|---|
| `003_phase5_expected_tracking.sql` | `sites.expected_tracking` (42703) | expected-vs-found tracking mismatch findings |
| `004_phase7_watchdog.sql` | `third_party_hosts`, `watchdog_alerts` (PGRST205) | the third-party watchdog — it runs after **every** scan and discards the result |
| `005_phase4_active_optin.sql` | `active_form_optin` (PGRST205) | per-site opt-in for active form submission |
| `009_client_resources.sql` | `client_resources` (PGRST205) | the client portal's Resources panel |
| `026_sentinel_guards.sql` | `sentinel_status.guards` (42703) | five Overview cards: DNS, Email, Security, SEO, Accessibility |
| `027_scans_pages_scanned.sql` (new) | `scans.pages_scanned` (42703) | the per-scan page count |

**`npm run db:deploy` does not apply any of these.** That is
`prisma migrate deploy` against the *Dashboard* Supabase project. LinkSpy's
migrations are plain SQL with no migrator and no ledger table, run by hand in
the Supabase SQL editor. The file names are not a record of what has been
applied; the database is, and `migrations/README.md` now says how to ask it.

#### Why none of this was visible

Two helpers in `database.py` turn a schema gap into a no-op:

- `_column_missing` is used **once**, for `guards`. The write is retried with
  the column dropped, so the row is still written and the guard results are
  thrown away every pass.
- `_tables_missing` is used at about **115** call sites. Its predicate matches
  the substring `"does not exist"`, which is the text of a missing **column**
  error as well as a missing table. So any write whose payload names a column
  the schema lacks is swallowed at any of those sites and reported as "this
  table is not migrated yet".
- `_OPTIONAL_SCAN_COLUMNS` is the same shape again: `_insert_scan` retries
  without `pages_scanned`. That column has never existed, which is why a scan's
  page count cannot be read back and has to be derived from `results_json`.

Each of these was written for a real reason — a missing table must not crash a
scan, and losing a whole scan row over one column was a worse bug. The failure
is that they are indistinguishable from success. Nothing counts a degraded
write, nothing logs one at a level anybody reads, and the UI shows the same
"unavailable" it would show for a check that had simply not run yet.

**This is the same shape as D15 and as the dead cron route: work that is
performed and then discarded, with no signal anywhere.** Guards are computed on
every sentinel pass for eight sites and dropped. The watchdog is computed after
every scan — roughly 3,300 of them — and dropped.

The fix is not to remove the tolerance. It is to make a degraded write say so:
count it, name the column, and surface it on a health endpoint, so "unavailable"
can be told apart from "not migrated". Not done here.

#### A daily job on a service that redeploys is a daily job that never runs

Related, and found while explaining why the Overview was stale. The sentinel is
registered with APScheduler as `interval, hours=24`, which first fires 24 hours
after the process starts. Railway redeploys on every merge. On 2026-09-19 there
were seven merges, so the timer was reset seven times and the newest row was
from a process that had been up since the previous day.

It is the same failure as D3's cron route: a schedule that looks configured and
does not fire. A wall-clock trigger (`cron`, a fixed hour) survives a restart
where an interval does not, and `misfire_grace_time` lets a pass that was missed
during a deploy run on the next boot. `_recompute_fragility_all` and
`_recompute_perf_all` already use `cron` with a grace time, two lines below the
sentinel that does not.

---

### D17 — A domain-expiry alert had six ways to reach nobody, all silent ✅ MOSTLY RESOLVED

**Found 2026-09-19, after apexure.com's 27-day alert reached a human only
because a forced pass collected alerts instead of sending them.**

The alert fired correctly. Everything after that is single-shot, unverified and
unrecorded.

| # | Failure | Where |
|---|---|---|
| 1 | **The rung advances before the alert is sent.** `upsert_sentinel_status` writes `prev_domain_days` first; the alert is computed and delivered afterwards. A delivery that fails is never retried, because the next pass compares against the advanced value and finds no crossing. | `sentinel.run_sentinel_for_site` |
| 2 | **Delivery exceptions are swallowed**: `try: await notify(a) except Exception: pass`. | same |
| 3 | **An unset webhook is a silent no-op**: `if not webhook_url: return`, with no log. All five emitters do this. | `main._watchdog_slack` and four others |
| 4 | **The POST result is never checked.** A revoked or renamed webhook answers 404/410 without raising, so it logs nothing and looks delivered. | `main._watchdog_slack` |
| 5 | **Nothing is persisted.** Ladder alerts are written to no table. `sentinel_incidents` is uptime-only, so "what fired, and did it arrive?" has no answer. | — |
| 6 | **No pass, no alert.** D16's interval-vs-redeploy problem means a day can go by without a sentinel run at all. | `main` scheduler |

A seventh, smaller: every sentinel alert is posted through `_watchdog_slack`,
whose header reads **"🐕 LinkSpy Watchdog — third-party outage"**. A domain
expiry would have arrived under a title describing something else.

Each rung fires exactly once per site per cycle. For a 30/14/3 ladder that is
three chances in the last month of a domain's life, each a single unverified
HTTP POST, with no record that it happened.

#### Fixed 2026-09-19

Items 1-3 and 7 are done; 4-6 remain.

**The ordering.** The pass now decides what to say, says it, finds out whether
it landed, and only then records what was said. Observing and telling are
separate: the columns always take the fresh observation, so the cards stay
current, while `guards.notified` holds what was actually delivered and moves
only on confirmation.

**Confirmation is required, not assumed.** `deliver_alerts` treats a truthy
return as delivery. `None`, `False` and any exception are unconfirmed, and each
one prints the message it could not deliver. `_watchdog_slack` now returns a
boolean, checks the HTTP status — a revoked webhook answers 404 without raising,
which is how a broken path stays quiet for months — and logs loudly when
`SLACK_WEBHOOK_URL` is unset instead of returning silently.

**The subtle half.** On a failure the OLD baseline is written back, not left
absent. `notified_baseline` falls back to the observed columns when nothing has
been recorded, and those advance every pass, so leaving the key absent would let
the baseline drift along behind the observation and lose the rung a second time.
Writing it back pins it. A test walks four consecutive failed passes and asserts
the rung fires on every one, then goes quiet only after a delivery succeeds.

**When only some alerts land**, none of the state advances, so the delivered
ones repeat next pass. A duplicate alert is a nuisance; a dropped one is a
monitoring system that reliably tells you nothing.

**Headers follow the message** (item 7), so an expiry no longer arrives titled
"third-party outage".

**`run_sentinel_all` reports what it managed**: sites given, completed, failed
with their errors, and alerts undelivered. It still refuses to let one site end
the sweep, but a run that completed 5 of 8 no longer returns the same shape of
good news as one that completed 8 of 8.

**DNS drift now retries like everything else.** It was the one alert type left
on the old behaviour: drift is detected inside `run_guards` by comparing against
a previous snapshot, and it was handed the STORED snapshot, which advances with
the observation — so a drift alert that failed to deliver was never re-detected.
It is now handed the snapshot from `guards.notified`, so the comparison is
against what we last told them. The snapshot that gets STORED is still the fresh
one, so the DNS card stays current. One exception is how a fixed class of bug
comes back.

**Still open**: no alert is persisted with its delivery outcome (item 4), there
is no heartbeat (item 5), and there is no second channel for the bottom rungs
(item 6).

#### What it takes to make one reach a human

In the order that removes the most risk per line changed:

1. **Alert on the condition, not the edge.** "Inside 30 days" is a state that
   persists; a crossing is a moment that can be missed. Fire every pass while
   the condition holds, deduplicated by a stored `last_notified_rung` and
   `last_notified_at` per site. A missed delivery then retries on the next pass
   by construction, and this alone fixes 1, 2 and 6.
2. **Separate observing from telling.** Advance the notified-rung state only
   after delivery reports success. What we saw and what we said are different
   facts and belong in different columns.
3. **Make delivery report.** Check the HTTP status; treat an unset webhook as a
   failure with a log line, not as nothing to do. A notifier that cannot
   deliver must say so where somebody looks.
4. **Record every alert** with its delivery outcome, so the question is
   answerable after the fact and a retry has something to read.
5. **Heartbeat.** A daily line saying the sentinel ran, over N sites, and
   delivered M alerts. Without one, silence means both "nothing wrong" and
   "nothing ran", which is how this went unnoticed.
6. **A second channel for the bottom rungs.** At 3 days a single webhook is one
   point of failure. Email or a second webhook, and the alert says which
   channels it reached.
7. **Fix the header** so the message describes what happened.

`SLACK_WEBHOOK_URL` is documented as optional with a silent return at all five
emitters, and whether it is actually set on Railway **cannot be established
from outside the deployment** — which is itself the point of item 3. Until 1-4
exist, the honest description of this path is: best effort, unverified, once.

---

### D18 — "Search visibility at risk" was read off pages that were not the client's ✅ RESOLVED

**Found and fixed 2026-09-19**, from two critical alerts raised in the same
sentinel pass. Neither response came from the site it described.

| Site | What we fetched | What we reported |
|---|---|---|
| `shopping-protection.com` | **HTTP 403** with a *"Just a moment…"* bot challenge, and the challenge page carries `noindex, nofollow` | "Homepage carries a noindex directive" — right by accident; the live page does carry one, but we had not seen the live page |
| `elitepractice.clickfunnels.com` | **HTTP 200** landing on ClickFunnels' `nopage_error.html`, because the funnel no longer exists | the same sentence, describing ClickFunnels' error page as the client's homepage |

`check_indexability` read `<meta name=robots>` and `X-Robots-Tag` from whatever
came back, with no test that it was the page asked for. A challenge page and an
error page both carry `noindex` of their own, so both produce a **critical**
verdict — the one severity the house rule reserves for a provable fault.

It now declines to read directives when the response cannot answer for the
client's page: a status at or above 400, a body matching the crawler's existing
`_BOT_BLOCK_PHRASES`, or a landing path that looks like an error page. The
directives become `None`, which the verdict already renders as **Unknown**
rather than **At risk**, and the reason is logged. A genuine `noindex` on a page
we actually read is still critical.

Both sites were then investigated by hand, and both turned out to have a real
problem that the false alert had been standing in front of: the funnel at
`elitepractice.clickfunnels.com` is **gone** (issue #161), and
`shopping-protection.com` really does carry `noindex, nofollow`, confirmed in a
browser (issue #160).

**The related gap is now closed.** A 200 that serves an error page used to be
invisible to every check: uptime sees a status under 500, the link checker sees
one under 400, and indexability correctly declines to judge it.
`resources.soft_404_problem` reads the signals the status line does not — the
platform's own error path, a title that says it plainly, a redirect onto a
different registrable domain — and corroborates with whether any word from the
URL appears on the page that loaded. Never `broken`, because a 200 is a 200 and
a page may legitimately be titled "Not Found". High confidence when the platform
named its own error page; low when it only looks like one. A URL that is itself
about errors is never flagged. Verified on 90 real client pages with no false
positives, and on the dead funnel in #161 with high confidence.

---

## 1. Per-surface variable tables

**Type** legend: `secret` (credential — rotate), `url` (endpoint), `flag`
(on/off), `tuning` (numeric), `platform` (injected by the host).

### 1.1 Railway — `brokenlinkchecker` service (LinkSpy backend)

FastAPI + Playwright/Chromium, `Dockerfile` at repo root, `CMD uvicorn main:app
--host 0.0.0.0 --port $PORT`. No `railway.json`/`nixpacks.toml`/`Procfile` in the
repo — Railway config is dashboard-managed, so the live variable set cannot be
verified from source. There is no pydantic `Settings` class; every read is a bare
`os.getenv`. `load_dotenv()` runs once at `database.py:7`.

| Variable | Purpose | Type | Shared with | Currently required |
|---|---|---|---|---|
| `SUPABASE_URL` | LinkSpy Supabase project URL for `create_client` (`database.py:9,15`) | url | — | **Yes** — `_get_client()` raises → 500 on every DB route |
| `SUPABASE_KEY` | Supabase **service-role** key; backend is the trust boundary (`auth.py:10-11`) | secret | — | **Yes** — same raise (misleadingly says `"supabase_url is required"`) |
| `PORTAL_ENFORCE` | Master authorization switch for all `require_*` deps (`auth.py:30`) | flag | — | **Effectively yes** — see D4 |
| `BACKEND_AUTH_SECRET` | HS256 key verifying portal tokens minted by the LinkSpy frontend (`auth.py:35`); Fernet key material (`tracer_crypto.py:23`) | secret | Vercel brokenlinkchecker | Only when `PORTAL_ENFORCE` is on |
| `NEXTAUTH_SECRET` | Fallback for the above — precedence `BACKEND_AUTH_SECRET or NEXTAUTH_SECRET or ""`, identical on both sides | secret | Vercel brokenlinkchecker | Fallback only |
| `SPINE_SECRET` | HMAC-SHA256 key for the spine bus, both directions (`main.py:3403`, `spine.py:98`) | secret | **Vercel dashboard, Vercel qa-ecosystem, Vercel brokenlinkchecker** | Yes for spine — inbox 503s without it |
| `QA_APP_URL` | Dashboard base for outbox POST + reconcile GET (`spine.py:97,166`) | url | — | Yes for spine — drain returns `{"skipped":"not configured"}` |
| `SPINE_CONSUME` | Whether inbound `deliverable.ready_for_qa` enqueues a `qa_battery` job (`main.py:3435`) | flag | — | No — off = record-only shadow |
| `PRESENCE_CHIPS` | Gates the **client presence chips** read + link endpoints (`main.py` `registry_bridge_client_presence`, `registry_bridge_link_client`). Only the literal `1` enables them | flag | *(same name, set separately, on Vercel dashboard)* | No — unset ⇒ both routes answer `404 presence_chips_disabled` |
| `FLYWHEEL` | Gap-analysis / candidate-drafting loop (`flywheel.py:88`) | flag | — | No — off = no-op |
| `AUTO_ENROLL` | Auto-enrol a site into weekly monitoring on `qa.completed` (`spine.py:47`) | flag | — | No |
| `JOBS_SHADOW` | Starts the asyncio jobs worker + 30-min shadow enqueue (`jobs.py:162`, `main.py:262`) | flag | — | **Effectively yes** — without it nothing drains (D7) |
| `JOBS_MONITORING_LIVE` | Whether `monitoring_scan` does real work (`jobs.py:144`) | flag | — | **Must stay unset** (D6) |
| `JOBS_LEASE_SECONDS` | `p_lease_seconds` for the `jobs_claim` RPC (`jobs.py:19`) | tuning | — | No — default `"60"` |
| `JOBS_POLL_SECONDS` | Sleep between empty claim polls (`jobs.py:20`) | tuning | — | No — default `"2"` |
| `SLACK_WEBHOOK_URL` | Incoming-webhook for all 5 notifiers (`main.py:97,342,2260,3057`, `spine.py:15`) | secret | — | No — every site does `if not webhook: return` |
| `FRONTEND_URL` | Base for report/share/invite links (`main.py:21`, `spine.py:56`) | url | — | No — `main.py` falls back to a hardcoded Vercel URL |
| `TRACER_CRYPTO_KEY` | Explicit Fernet key for CRM credential encryption at rest (`tracer_crypto.py:20`) | secret | — | No — falls back to the auth secrets; `RuntimeError` if all three unset |
| `TRACER_ENABLED` | Arms the daily lead-tracer sweep (`tracer.py:26`) | flag | — | No |
| `ACTIVE_FORM_TESTING` | Global switch for active (submitting) form tests (`active_submission.py:39`) | flag | — | No |
| `SELF_HEAL` | Master switch for the self-heal PR opener (`self_heal.py:44`) | flag | — | Yes for that route — 403 `"SELF_HEAL is off."` |
| `SELF_HEAL_ALLOWLIST` | Comma/space list of `owner/repo` allowed to receive PRs (`self_heal.py:51`) | — | — | Yes for that route — empty ⇒ every repo 403 |
| `SELF_HEAL_GITHUB_TOKEN` | GitHub token for opening fix PRs (`main.py:1732`) | secret | — | Yes for that route — 400 `refused: true` |
| `PORT` | Injected by Railway; used by `Dockerfile` shell only | platform | — | **Dead in Python** (D10) |

### 1.2 Vercel — `brokenlinkchecker` project (LinkSpy frontend)

Next.js, NextAuth **v4** (`next-auth@4.24.14`). No `vercel.json`, no
`.env.example` — every var below is undocumented in-repo.

| Variable | Purpose | Type | Shared with | Currently required |
|---|---|---|---|---|
| `BACKEND_URL` | Server-side origin for every Next→Railway proxy fetch (~90 route files) | url | — | **Yes** — defaults to `http://localhost:8000`; silently fails on Vercel |
| `NEXT_PUBLIC_BACKEND_URL` | Client-side SSE origin, bypassing Vercel's function timeout for long scans (`app/page.tsx:208`) | url | — | No — falls back to the same-origin proxy, but long scans then time out |
| `NEXTAUTH_SECRET` | JWT decryption for the middleware auth wall (`middleware.ts:7`); fallback backend-token key | secret | Railway | **Yes** — `getToken` null ⇒ every request redirects to `/login` |
| `NEXTAUTH_URL` | Canonical callback base; read by NextAuth internals, not app code | url | — | Optional on Vercel (derived from `VERCEL_URL`); needed for a custom domain |
| `BACKEND_AUTH_SECRET` | Primary HS256 key minting the backend token (`lib/backendToken.ts:10`) | secret | Railway | No — degrades to anonymous backend calls |
| `GOOGLE_CLIENT_ID` | Google OAuth client (`app/api/auth/[...nextauth]/route.ts:9`) | secret | — | **Yes** — non-null asserted; OAuth errors without it |
| `GOOGLE_CLIENT_SECRET` | Google OAuth token exchange (`:10`) | secret | — | **Yes** — fails at callback |
| `SPINE_SECRET` | HMAC key for handoff tokens (`api/handoff/sign/route.ts:9`, `handoff/route.ts:17`, `api/delivery/route.ts:21`) | secret | **Railway, Vercel dashboard, Vercel qa-ecosystem** | Yes for handoff — sign 503s |
| `DASHBOARD_APP_URL` | Base origin handoff links point at (`api/handoff/sign/route.ts:15`) | url | — | Yes for handoff — 400 `"no target base"` |
| `DASHBOARD_BRIDGE_URL` | Dashboard read-API origin for delivery data (`api/delivery/route.ts:35`, `api/presence/delivery/route.ts:33`) | url | — | No — Delivery panel + presence line degrade quietly (**D1 resolved**) |
| `DASHBOARD_BRIDGE_KEY` | Bearer credential for that bridge (`:36`, `presence:34`) | secret | Vercel dashboard | No — as above (**D1 resolved**) |
| `PRESENCE` | Gates the **delivery-presence line** on Site Detail (`api/presence/delivery/route.ts:26`). Only the literal `1` enables it | flag | *(same name, set separately, on Vercel dashboard)* | No — unset ⇒ the Overview is byte-identical to pre-presence |
| `CRON_SECRET` | **Unused in LinkSpy since 2026-09-19** — its only consumer, `/api/cron/auto-scan`, was deleted (D3). Still live on the *Dashboard* for `/api/spine/drain` | secret | Vercel dashboard | No — safe to remove from the LinkSpy project |
| `GITHUB_WEBHOOK_SECRET` | HMAC verification of GitHub deployment webhooks (`api/webhooks/github/route.ts:6`) | secret | GitHub repo settings | Yes for that route — 401 otherwise |
| `AUTH_SECRET` | — | — | — | **Dead** — v5 name (D10) |
| `AUTH_TRUST_HOST` | — | — | — | **Dead** — v5 name (D10) |

### 1.3 Vercel — `dashboard` project (Deliverables Dashboard)

Next.js 16 + Prisma 6. `vercel.json` pins `regions: ["syd1"]` and one cron.
Auth is a shared team password + signed cookie — **not** NextAuth.

| Variable | Purpose | Type | Shared with | Currently required |
|---|---|---|---|---|
| `DATABASE_URL` | Supabase **pooled** connection, port 6543/pgbouncer (`schema.prisma`) | secret | — | **Yes** |
| `DIRECT_URL` | Supabase **session** connection, port 5432 — migrations + bulk import (`schema.prisma`, `prisma/import-2026.ts:8`) | secret | — | **Yes** |
| `APP_PASSWORD` | Shared team password, timing-safe compared (`lib/auth.ts:35`) | secret | — | **Yes** — empty ⇒ nobody can log in |
| `AUTH_SECRET` | HMAC key signing the `session` cookie (`lib/auth.ts:10`) | secret | — | **Yes** — falls back to the literal `"dev-secret"` |
| `SPINE_SECRET` | HMAC for spine inbox + drain, Bearer for outbox-status, handoff verification (`api/spine/inbox/route.ts:11`, `drain:37`, `outbox-status:7`, `handoff/route.ts:16`) | secret | **Railway, Vercel qa-ecosystem, Vercel brokenlinkchecker** | Yes for spine — inbox 503s, handoff redirects home |
| `SPINE_EMIT` | Gates whether outbox rows are ever written (`lib/spine-emit.ts:9`) | flag | — | No — unset ⇒ status actions behave identically to pre-spine |
| `CRON_SECRET` | Bearer auth on `/api/spine/drain` (`drain:21`) | secret | Vercel brokenlinkchecker *(separate endpoint)*, Vercel cron | **Fails open if unset** (D13) |
| `LINKSPY_API_URL` | LinkSpy backend base for the registry + QA-bridge clients (`lib/registry.ts:11`, `lib/linkspy/client.ts:18`, `drain:36`) | url | — | No — feature silently unavailable |
| `LINKSPY_API_KEY` | Bearer service key for those calls; **server-only, never reaches the browser** | secret | LinkSpy (validated backend-side) | No — `registryConfigured()` false ⇒ typed "unavailable" |
| `LINKSPY_APP_URL` | LinkSpy dashboard base for operator deep links (`lib/linkspy/client.ts:24`) | url | — | No — falls back to `LINKSPY_API_URL`, then plain instructions |
| `PRESENCE` | Gates the **production-presence strip** on the page checklist view (`lib/linkspy/presence-shape.ts:37` via `lib/linkspy/presence.ts:62`). Only the literal `1` enables it | flag | *(same name, set separately, on Vercel brokenlinkchecker)* | No — unset ⇒ the checklist view is byte-identical to pre-presence |
| `PRESENCE_CHIPS` | Gates the **client presence chips** on client detail + list (`lib/linkspy/client-presence-chips-shape.ts` `presenceChipsEnabled()`) and the "Link to LinkSpy" action. Only the literal `1` enables it | flag | *(same name, set separately, on Railway)* | No — unset ⇒ client pages are byte-identical to pre-chips |
| `DEVICEPREVIEW_URL` | Base URL of the devicepreview Railway service (§1.5) for the Device preview section on Layout checks pages (`lib/devicepreview/client.ts`, `api/devicepreview/*`) | url | — | No — section shows "not configured" |
| `DEVICEPREVIEW_KEY` | Bearer key for that service; **server-only, never reaches the browser** | secret | Railway devicepreview (`DEVICEPREVIEW_KEY`) | No — as above |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | **Set by Vercel itself, nothing to configure.** The Device health panel prints it beside the commit the preview service reports (`lib/layout-checks/service-line.ts`), so "is the service running what I merged" is read there rather than inferred | build var | *(Vercel, automatic)* | No — unset (local builds) ⇒ the line names the service's build only |
| `ANTHROPIC_API_KEY` | Enables Claude judgment in the AI QA agent (`lib/ai/anthropic.ts:5`) | secret | — | No — deterministic checks still run |
| `E2E_PASSWORD` | Playwright login; must equal the server's `APP_PASSWORD` (`e2e/auth.setup.ts:15`) | secret | — | Test-only |
| `NODE_ENV` | Cookie `secure` flag, Prisma client caching | platform | — | Injected |

### 1.4 Vercel — `qa-ecosystem` project (apexure-shell)

Deployed at `qa-ecosystem-2i6v.vercel.app`. Small — 11 source files, no
`vercel.json`. NextAuth v4 with a Google Workspace domain gate.

| Variable | Purpose | Type | Shared with | Currently required |
|---|---|---|---|---|
| `SPINE_SECRET` | HMAC-SHA256 key signing handoff tokens for both doors (`app/go/[app]/route.ts:14`) | secret | **Railway, Vercel dashboard, Vercel brokenlinkchecker** | **Yes** — unset ⇒ both doors silently 302 to `/` |
| `DASHBOARD_URL` | Base URL of the Dashboard app (`route.ts:8`) | url | — | **Yes** for the dashboard door |
| `LINKSPY_URL` | Base URL of LinkSpy (`route.ts:9`) | url | — | **Yes** for the linkspy door |
| `GOOGLE_CLIENT_ID` | Google OAuth client (`lib/auth.ts:11`) | secret | — | Yes **if auth is re-enabled** (D5) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret (`lib/auth.ts:12`) | secret | — | Yes **if auth is re-enabled** |
| `NEXTAUTH_SECRET` | JWT signing; read by NextAuth internals, not app code | secret | — | **Yes in production** — v4 throws `NO_SECRET` without it |
| `NEXTAUTH_URL` | Callback base; derived from `VERCEL_URL` on Vercel | url | — | Optional |
| `BOARD_URL` | Third door, not yet wired | url | — | **No** — never read (D10) |

Door registry (`app/go/[app]/route.ts:7-10`, evaluated at module load):

| Slug | Target | State |
|---|---|---|
| `dashboard` | `DASHBOARD_URL` → `{base}/handoff?token=…` | live |
| `linkspy` | `LINKSPY_URL` → `{base}/handoff?token=…` | live |
| `board` | absent from `DEST` | 302 to `/`; UI card is inert (`disabled`, badge "Soon") |

---

### 1.5 Railway — `devicepreview` service (cross-device preview) — TO BE CREATED

`services/devicepreview/`: the CLI plus `server.py` (FastAPI, same stack as the
LinkSpy backend), started by its `Dockerfile` (`uvicorn server:app --port $PORT`).
The Dockerfile installs fonts and Playwright's three engines and fails the build
if font fallback is broken. Railway builds it from the repo with **root
directory `services/devicepreview`**. Attach a **volume at `/app/runs`** so run
galleries survive redeploys. Sizing: the service keeps two runs per site and
strips the older one to JPEGs, so budget ≈ 100 MB per site (one run of PNGs at
50–70 MB for the fourteen-profile matrix on a long page, plus two runs of
900 px JPEGs at ≈ 13 MB each); the total floats with the number of sites, not
with how often one is checked. Steps, and the survival test that tells a real
mount from a mistyped path, are in `docs/runbooks/devicepreview-volume.md`.
Reads no `.env`; every variable is process environment. **Fails closed:** with `DEVICEPREVIEW_KEY` unset every request is
`503`, so this surface does not join the fail-open list in D13.

| Variable | Purpose | Type | Shared with | Currently required |
|---|---|---|---|---|
| `DEVICEPREVIEW_KEY` | The one service key; `Authorization: Bearer` or `X-Api-Key`, constant-time compare (`server.py` `_gate`) | secret | Vercel dashboard (`DEVICEPREVIEW_KEY`, piece 2) | **Yes** — unset ⇒ 503 on every route |
| `RUNS_DIR` | Run storage; the volume mount point | tuning | — | No — default `/app/runs` (set in the Dockerfile) |
| `RETAIN_PER_SITE` | Runs kept per URL, newest first; the rest deleted after each run. Only the newest run of a URL keeps PNG originals and gallery, older kept runs hold report + JPEG derivatives | tuning | — | No — default `2` |
| `DERIVATIVE_WIDTH` / `DERIVATIVE_QUALITY` | Size / quality of the JPEG made of every capture at run completion | tuning | — | No — defaults `900` / `82` |
| `RUN_TIMEOUT_S` | Hard stop per run | tuning | — | No — default `900` |
| `DEVICEPREVIEW_CONCURRENCY` | Engines in parallel inside a run; lower on a small instance | tuning | — | No — default `2` |
| `MAX_RUNNING` | Runs accepted at once; more get `429 run_capacity` | tuning | — | No — default `1` |
| `PORT` | Injected by Railway; consumed by the Dockerfile `CMD` | platform | — | Injected |

**Railway logs cannot be purged.** Retention is time-based only and set by the
plan (Hobby 7 days, Pro 30, Enterprise up to 90); there is no dashboard action
or API to delete logs early, and upgrading a plan *restores* previously aged-out
logs rather than removing any. So anything the service writes to stdout —
including anything uvicorn puts in an access line, which is the full query
string — is retained for the plan's window and cannot be taken back. Nothing
secret may travel in a URL to this service. (Checked against Railway's docs,
2026-09-09.)

**Live sessions reach this service directly from the browser.** The Dashboard
mints a short-lived token (`/api/devicepreview/live-token`, signed with
`DEVICEPREVIEW_KEY`) and the page opens a websocket straight to
`wss://<this service>/api/devicepreview/live-session`. Vercel does not hold
websockets, and proxying frames through it would double the bandwidth for no
gain — so the Railway service must be reachable from the public internet, which
it already is. The service key never leaves the server; the token pins one url
and one profile for two minutes.
| `BROWSERSTACK_USERNAME` | Basic-auth user for the Screenshots REST API (`devicepreview.py` `browserstack_credentials`) | secret | — | Only with `--backend browserstack`; unset ⇒ the backend stops and prints how to enable it |
| `BROWSERSTACK_ACCESS_KEY` | Basic-auth key for the same | secret | — | As above |
| `BROWSERSTACK_KEY` | Alternative single value `user:key` (the spec's name) | secret | — | Alternative to the pair |

Optional tooling, not a variable: `odiff` on PATH (or `--odiff "npx -y odiff-bin"`)
speeds up `--baseline` diffing; Pillow does the work otherwise. The BrowserStack
backend needs a plan that includes the Screenshots API and has not yet been run
against a live account.

## 2. Shared-secret map

### `SPINE_SECRET` — 4 surfaces

The most widely shared value in the ecosystem. Must be **byte-identical** on
Railway, Vercel `dashboard`, Vercel `qa-ecosystem`, and Vercel
`brokenlinkchecker`. (The original brief listed three surfaces — the LinkSpy
frontend is the fourth, and it needs the value for handoff signing.)

It carries **three different auth mechanisms**, which is worth knowing when
rotating:

1. **Spine envelope HMAC** — `HMAC-SHA256(secret, rawBody)` → lowercase hex,
   sent as `x-spine-signature` with `x-spine-sent-at` (unix seconds).
   `SKEW_MAX_SECONDS = 300`. Verified with `timingSafeEqual` /
   `hmac.compare_digest`. Contract duplicated verbatim in
   `backend/spine_contract.py` and `src/lib/spine-contract.ts`, guarded by
   `CONTRACT_CHECKSUM = 36924adb…`.
2. **Handoff token** — `base64url({target_path, exp, nonce}) + "." + hex HMAC`.
   `HANDOFF_MAX_TTL_S = 300`, hard-capped. Guarded by
   `HANDOFF_CHECKSUM = 90b6a00d…` — **verified identical in the shell and
   Dashboard copies**.
3. **Plain bearer** — LinkSpy's reconcile (`spine.py:178`) uses the same secret
   as `Authorization: Bearer …` against the Dashboard's `/api/spine/outbox-status`.
   A weaker mode on the same key; noted, not currently a defect.

### `DASHBOARD_BRIDGE_KEY` — 1 surface, orphaned

Set on Vercel `brokenlinkchecker` only. Read at
`frontend/app/api/delivery/route.ts:36`. **Validated by nothing** — see D1.

### `LINKSPY_API_KEY` — 1 surface + backend validation

Set on Vercel `dashboard`; sent as `Authorization: Bearer …` to
`{LINKSPY_API_URL}/api/registry/*` and `/api/qa-bridge/*`. Read server-side only
(`src/lib/registry.ts`, `src/lib/linkspy/client.ts` — both `import "server-only"`),
so it never reaches the browser. Not read by the LinkSpy *frontend*; the LinkSpy
*backend* is what authorizes it.

### `BACKEND_AUTH_SECRET` / `NEXTAUTH_SECRET` — Railway + Vercel brokenlinkchecker

Precedence is identical on both sides — `BACKEND_AUTH_SECRET or NEXTAUTH_SECRET
or ""` (`lib/backendToken.ts:10`, `backend/auth.py:35`). Mints a hand-rolled
HS256 JWT `{email, iat, exp}`, default TTL 3600s frontend-side, 30 days for
portal tokens backend-side.

### `CRON_SECRET` — 2 surfaces, 2 unrelated endpoints

Not one shared secret in practice. Vercel `dashboard` uses it for
`/api/spine/drain`; Vercel `brokenlinkchecker` uses it for `/api/cron/auto-scan`.
They may hold different values. **Both fail open when unset.**

### Missing / dead summary

| Secret | Referenced in code at | Missing from | Note |
|---|---|---|---|
| `DASHBOARD_BRIDGE_KEY` | LinkSpy frontend | Dashboard (no consumer route) | D1 |
| `SPINE_SECRET` | 4 surfaces | Dashboard `.env.example` | D11 |
| `SPINE_EMIT` | Dashboard | Dashboard `.env.example` | D11 |
| `CRON_SECRET` | Dashboard, LinkSpy frontend | Dashboard `.env.example` | D11 |
| `AUTH_SECRET`, `AUTH_TRUST_HOST` | nowhere (v5 names) | — | Dead if set on Vercel brokenlinkchecker |
| `PORT` | `Dockerfile` only | — | Dead in Python |

---

## 3. Flags registry

All flags below are **off/unset by default**, with one marked exception:
`TRACKING_CONSISTENCY` is a scan check's kill switch, so unset means ON.
Remember D8: the spine/jobs flags accept **only the literal string `1`**.

| Flag | Surface | Test | ON | OFF / unset |
|---|---|---|---|---|
| `JOBS_SHADOW=1` | Railway | `== "1"` | Starts the asyncio jobs worker at boot + a 30-min `shadow_enqueue_monitoring` APScheduler job | **No worker exists at all** — the queue is never drained (D7) |
| `SPINE_EMIT=1` | Vercel dashboard | `=== "1"` | Status/cert transitions write `SpineOutbox` rows inside the same transaction | No row is ever written; status actions behave byte-identically to pre-spine |
| `SPINE_CONSUME=1` | Railway | `== "1"` | Inbound `deliverable.ready_for_qa` enqueues a `qa_battery` job | Event still lands in `spine_inbox` + timeline, but `enqueued: false` — record-only shadow |
| `AUTO_ENROLL=1` | Railway | `== "1"` | On `qa.completed`, enrols an unmonitored site into Weekly monitoring + timeline + Slack | `{"enrolled": false}`. Already-monitored sites are skipped either way, so cadence is never downgraded |
| `FLYWHEEL=1` | Railway | `!= "1"` → skip | `on_incident_resolved` classifies the incident and may draft a checklist candidate + enqueue a spine event | Returns `{"skipped": true}` before any DB import — pure no-op |
| `JOBS_MONITORING_LIVE` | Railway | `== "1"` | **`RuntimeError` — the live path is deliberately unimplemented (D6)** | Correct state. Prints `[jobs:shadow] would scan site=… — dry-run` |
| `TRACKING_CONSISTENCY=0` | Railway | in `{0,false,no,off}` → skip | Switches the site-wide tracking consistency check OFF | **Unset means ON** — the check runs and the scan result carries `tracking_consistency`. Each scan check owns its own switch, so one can be retired without touching the others |

Sequencing note: the flywheel only produces visible effect with
`JOBS_SHADOW=1` **and** `SPINE_SECRET` set on Railway, plus `SPINE_EMIT=1` on the
Dashboard for the reverse direction.

---

## 3b. Reaching the LinkSpy database

**Use the session pooler on 5432. The direct host is IPv6-only and does not
resolve over IPv4**, which is twenty minutes of "the hostname is wrong" before
anyone thinks to check the address family. This cost that once on 2026-09-19.

| | |
|---|---|
| Host | `aws-1-ap-southeast-1.pooler.supabase.com` |
| Port | **5432** (session mode) |
| Database | `postgres` |
| User | `postgres.uyvjqaggkqotqcqjwxgm` — the project ref is the part after the dot |
| Server | PostgreSQL 17.6 |
| Env var | `LINKSPY_DIRECT_URL`, **Railway only** |

Three ports, three behaviours, and only one of them works for a dump:

- **5432 session pooler** — what to use. Holds a real session, so `pg_dump`,
  `psql -f` and transactions all behave.
- **6543 transaction pooler** — pgbouncer in transaction mode. **Breaks
  `pg_dump`**, and prepared statements with it.
- **`db.<ref>.supabase.co` direct** — IPv6-only. It resolves to a AAAA record
  and nothing else, so on an IPv4-only network it looks like a dead hostname
  rather than an unreachable one.

`PGSSLMODE=require`. The `pg_dump` client major version must be at or above the
server's 17.

**`npm run db:deploy` has nothing to do with this database.** That is
`prisma migrate deploy` against the *Dashboard* project. LinkSpy's migrations
are plain SQL run by hand; see `services/linkspy-api/migrations/README.md`.

**Getting the URL to a tool that is not your interactive shell.** An `export`
in a terminal does not reach a subprocess started from elsewhere. Write it to a
file that gets deleted afterwards, rather than pasting it anywhere that keeps a
transcript:

```bash
printf 'LINKSPY_DIRECT_URL=%s\n' "$LINKSPY_DIRECT_URL" > ~/.linkspy-dump.env
chmod 600 ~/.linkspy-dump.env
# … do the work …
shred -u ~/.linkspy-dump.env
```

Dump before any DDL — free tier, no point-in-time recovery, on both projects.
`docs/runbooks/backup.md` has the commands; verify with `pg_restore --list`
before believing the file.

---

## 4. External services

### Supabase — two separate projects, both FREE TIER

| Project | Consumed by | Connection |
|---|---|---|
| **QA / Deliverables** | Dashboard (Prisma) | `DATABASE_URL` (6543, pooled) + `DIRECT_URL` (5432, session) |
| **LinkSpy** | LinkSpy backend (`supabase-py`) | `SUPABASE_URL` + `SUPABASE_KEY` (service role) |

**Free tier ⇒ no PITR, no automatic downloadable backups.** The dump you take by
hand is the only copy that exists. Constitution rule 3: *no dump, no migration.*

**Connection string shape** (placeholders — never commit real values):

```
# pooled / transaction — app runtime, pgbouncer
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true

# session — migrations, bulk import, AND pg_dump
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
```

Use the **pooler host in session mode (5432)** for `pg_dump` — the true direct
host (`db.<PROJECT_REF>.supabase.co`) is IPv6-only. Never dump against 6543:
pgbouncer in transaction mode breaks `pg_dump`. See D9.

**`pg_dump` requires PostgreSQL 17 client** — the server is PG17 and the client
major must be ≥ the server. On Windows: `C:\Program Files\PostgreSQL\17\bin`.
A v16 client aborts with *"server version mismatch"*.

### `C:\backups`

All dumps land in **`C:\backups`** — deliberately **outside OneDrive**, which has
previously locked and corrupted files in the working tree. Dumps are
secrets-adjacent (they contain all data): never commit them; `*.dump` / `*.sql`
belong in `.gitignore`.

Baseline of record (Gate −1, 2026-07-15):
`C:\backups\qa-dashboard-20260715-224052.dump` — 424,516 bytes, `pg_restore
--list` exit 0, all app tables present.

### Cron

| Job | Where | Schedule | Auth |
|---|---|---|---|
| Spine outbox drain | **cron-job.org** → Dashboard `/api/spine/drain` | every 5 min | `Authorization: Bearer {CRON_SECRET}` |
| Spine outbox drain | **Internal APScheduler** → LinkSpy job queue | every 5 min | none (in-process) |
| Monitored-site scans | **Internal APScheduler** → LinkSpy backend, one job per `monitoring_enabled` site | each site's own cadence | none (in-process) |
| ~~Auto-scan~~ | ~~LinkSpy frontend `/api/cron/auto-scan`~~ | **route deleted 2026-09-19 (D3)** | — |

**The Vercel cron was removed** (2026-07-20). `vercel.json` previously carried
`{ "path": "/api/spine/drain", "schedule": "0 3 * * *" }`, but Vercel **Hobby**
only permits daily crons, which was too slow to be useful. The external
cron-job.org job at a 5-minute cadence supersedes it. `vercel.json` still exists
— it pins `regions: ["syd1"]` to co-locate functions with the Sydney Supabase
project, which must not be removed.

Consequence to be aware of: **the automated drain now depends entirely on an
external service.** If the cron-job.org job is paused or its bearer drifts,
nothing on Vercel will pick up the slack — the queue simply grows. Watch the
*"spine heartbeat silent >2h"* Slack alert as the signal. For immediate
delivery, drain manually (see runbook 5.4) — the route is idempotent and unrated.

`/api/cron/auto-scan` no longer exists (D3). Scheduled scanning is the LinkSpy
backend's own APScheduler, which needs no external trigger; a cron pointed at
the frontend was collecting 307s. Any future external heartbeat points at the
backend.

### Slack

One incoming webhook (`SLACK_WEBHOOK_URL`, Railway only), five emitters:

| Emitter | Fires on |
|---|---|
| `send_slack_notification` | Completed scan results |
| `_watchdog_slack` | Third-party outage / sentinel / uptime / lead-tracer alerts |
| `_report_slack` | Vigilance report ready — links to `{FRONTEND_URL}/reports/{id}` |
| `_consent_drift_alert` | Consent observation drift (silent on first run) |
| `spine._slack` | Auto-enrol confirmation; spine heartbeat silent >2h; reconcile drift; flywheel probe needed |

All best-effort — exceptions are swallowed (`spine.py:21`, `main.py:2269`).

---

## 4b. Boards — the capability link, and what the developer view never receives

Boards is a section of the Dashboard behind the normal session. The
developer-facing view is the exception, reached only by a capability link:

| Surface | Credential | What it serves |
|---|---|---|
| `/dashboard/boards`, `/dashboard/boards/[projectId]` | session | QA's board: every field, every move, the link controls |
| `/b/[boardShareId]` | `Project.boardShareId` in the URL | one project's board, no shell, `noindex` |
| `/api/board-image?id=…` | session **or** `&share=<boardShareId>` matching the image's project | a card image; any miss is a 404, so the route cannot be probed |

`Project.boardShareId` is the same mechanism as `Page.shareId`: a random
12-byte token on the row, `NULL` to revoke, minted from the board page. There
is no `CapabilityLink` table; the capability is a column, on both models.

**What the developer view never receives**, enforced server-side by
`developerView()` in `src/lib/boards.ts` as a whitelist: severity, the
recurring flag, the reporter, and the page-review `status`. Priority reaches
the developer as card ORDER within a column and nothing else. A developer may
move their own cards between the working stages and hand one to QA
(`COMPLETED`); only QA closes, and only QA reopens a closed card — "the
developer says done" and "QA confirmed" are two different people's acts, and
the bounce-back metric lives in the gap between them.

**Attribution on today's single shared session.** `Issue.reporterId` and the
QA-side `IssueEvent.actorId` are nullable and stay null: there is no per-person
identity to record until access control ships. The developer side is
attributed, because the card's assignee is who acted. The access-control work
exists as `feat/access-control`, one commit whose diff against main deletes
most of this month's work — it needs a rebase before it can be merged, not a
merge.

## 5. Runbooks

### 5.1 Adding an environment variable

**Railway (`brokenlinkchecker`)**
1. Service → **Variables** → **New Variable**.
2. **Railway does not auto-restart on variable change** — click **Deploy** (or
   Deployments → Redeploy) explicitly. The value is not live until you do.
3. Verify: `GET /api/spine/health`-equivalent, or check startup logs for the
   flag echo at `main.py:3317-3318`.

**Vercel (any of the three projects)**
1. Project → **Settings → Environment Variables** → add for **Production**
   (and Preview/Development if needed).
2. **Existing deployments do not pick it up** — trigger a redeploy:
   Deployments → ⋯ → **Redeploy**, or push an empty commit.
3. `NEXT_PUBLIC_*` vars are **inlined at build time** — a redeploy is mandatory,
   not optional.
4. Verify: Dashboard → `GET /api/spine/health` returns `{ emit: true|false, … }`.

### 5.2 Rotating a secret

Order matters — rotate the consumer last where a mismatch would drop traffic.

**`SPINE_SECRET`** (4 surfaces; HMAC has ±300s skew but **no key rotation
grace** — a mismatch is a hard 401)
1. Generate: `openssl rand -hex 32`.
2. Drain first: `POST /api/spine/drain` on the Dashboard until
   `{ remaining: 0 }`, so no signed-in-flight events are stranded.
3. Update **all four** surfaces: Railway, Vercel `dashboard`, Vercel
   `qa-ecosystem`, Vercel `brokenlinkchecker`.
4. Redeploy all four (Railway needs explicit Deploy).
5. Verify: shell `/go/dashboard` completes the handoff; Dashboard
   `/api/spine/health` shows deliveries resuming; watch for the
   *"spine heartbeat silent >2h"* Slack alert as the failure signal.

**`DASHBOARD_BRIDGE_KEY`** — currently inert (D1). Rotate freely, or delete it
and `DASHBOARD_BRIDGE_URL` together once the decision on the bridge is made.

**`LINKSPY_API_KEY`**
1. Mint in LinkSpy: Site → Settings → QA Dashboard link.
2. Set on Vercel `dashboard`, redeploy.
3. Verify: the "Still True Today" module on a page detail renders live status
   instead of its quiet "not yet linked" state. Failure is silent by design
   (`registryConfigured()` false ⇒ typed "unavailable"), so check the UI, not logs.

**`CRON_SECRET`** — remember these are two independent values.
- Dashboard: set → redeploy → confirm the Vercel cron run at 03:00 UTC returns
  200, or drain manually with the new bearer.
- LinkSpy frontend: set → redeploy → update the cron-job.org job header.
- **Never leave unset** — both endpoints fail open (D13).

**`APP_PASSWORD` / `AUTH_SECRET` (Dashboard)** — rotating `AUTH_SECRET`
invalidates every existing `session` cookie (30-day maxAge), logging the whole
team out. Expected, but announce it. Keep `E2E_PASSWORD` equal to
`APP_PASSWORD` or Playwright's `auth.setup.ts` will fail.

**`SUPABASE_KEY`** — service role. Rotate in Supabase → Settings → API, then
Railway → Deploy. Every DB route 500s in the gap, so do it in a quiet window.

### 5.3 Taking a dump (do this before ANY migration)

```bash
export PGSSLMODE=require                 # Supabase requires SSL
STAMP="$(date +%Y%m%d-%H%M%S)"

# QA / Deliverables — session mode (5432), pooler host
pg_dump "$DIRECT_URL" --no-owner --no-privileges --format=custom \
  --file="C:/backups/qa-dashboard-${STAMP}.dump"

# Verify it is real before trusting it
pg_restore --list "C:/backups/qa-dashboard-${STAMP}.dump" | head -40
ls -l "C:/backups/qa-dashboard-${STAMP}.dump"
```

```bash
# LinkSpy
pg_dump "$LINKSPY_DIRECT_URL" --no-owner --no-privileges --format=custom \
  --file="C:/backups/linkspy-${STAMP}.dump"
pg_restore --list "C:/backups/linkspy-${STAMP}.dump" | head -40
```

Then record the filename in the migration PR. Checklist:

```
- [ ] Dump taken against the target project
- [ ] Dump filename: __________________________
- [ ] Verified: size = _____ , pg_restore --list shows expected tables
- [ ] Stored in C:\backups (outside OneDrive)
- [ ] Migration is additive-only (no DROP / rename / type-narrowing)
```

Full detail, restore procedure and the free-tier rationale live in
`docs/runbooks/backup.md` (mirrored in both repos).

### 5.4 Manual drain

The daily Vercel cron is often too slow while testing. The route is idempotent
and has no rate limit — call it as often as you like.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<dashboard-host>/api/spine/drain
# → {"delivered":N,"failed":N,"remaining":N,"heartbeat_emitted":bool}
```

Both `GET` and `POST` are accepted. Repeat until `remaining: 0`.

Diagnosing a drain that does nothing:

| Symptom | Cause |
|---|---|
| `{"skipped":"spine not configured"}` | `LINKSPY_API_URL` or `SPINE_SECRET` unset on the Dashboard |
| `401 unauthorized` | `CRON_SECRET` mismatch |
| `failed > 0`, rows retry forever | Check `SpineOutbox.lastError`; usually a 401 from LinkSpy ⇒ `SPINE_SECRET` drift, or `>300s` clock skew |
| Nothing ever enqueued | `SPINE_EMIT` is not `1` on the Dashboard |
| LinkSpy side never drains | `JOBS_SHADOW` is not `1` on Railway — no worker exists (D7) |

Health check (unauthenticated, safe to curl):

```bash
curl https://<dashboard-host>/api/spine/health
# → {"emit":bool,"undelivered":N,"last_delivered_at":"…"}
```

---

## Manual cleanup required

Dashboard-console changes an operator must make by hand — environment variables
cannot be removed from a repo, and the Vercel/Railway CLIs are not wired up here.

### Vercel `brokenlinkchecker` project — remove two dead variables

`AUTH_SECRET` and `AUTH_TRUST_HOST` are **NextAuth v5** names. That app runs
NextAuth **v4** (`next-auth@4.24.14`), which reads `NEXTAUTH_SECRET`. Both are
inert: setting them does nothing, and their presence misleads anyone reading the
env list into thinking they are the live auth secrets. See D10.

For each of `AUTH_SECRET`, then `AUTH_TRUST_HOST`:

1. Vercel dashboard → **brokenlinkchecker** project → **Settings** →
   **Environment Variables**.
2. Find the variable in the list.
3. Three-dot menu (⋯) at the right of its row → **Remove** → confirm.
4. After removing both: **Deployments** → latest production deployment →
   ⋯ → **Redeploy**.
5. Verify sign-in still works — `NEXTAUTH_SECRET` is the one that matters, and
   it must remain set. If sign-in breaks, you removed the wrong variable.

> Do these two together and redeploy once. Removing an env var does **not** take
> effect until a redeploy.

### Not to be removed — checked and live

Recorded here because it has been proposed for removal on the mistaken belief
that it is unused:

| Variable | Surface | Status |
|---|---|---|
| `LINKSPY_APP_URL` | Vercel `dashboard` | **LIVE — do not remove.** Read at `src/lib/linkspy/client.ts:24` (`linkspyAppUrl()`) and `src/app/dashboard/checklists/candidates/page.tsx:27`. Removing it makes operator deep links fall back to `LINKSPY_API_URL` — the *backend* base, not a URL a human should land on — and strips the LinkSpy links from the checklist-candidates page entirely. |
| `AGENCY_APP_URL` | — | **Does not exist.** Zero references in any of the three repos. If you see it set on a Vercel project, it is genuinely dead and safe to remove, but it is not part of this system. |

`BOARD_URL` on Vercel `qa-ecosystem` is also unread, but leave it — it is
deliberate scaffolding for the third door (D10).

---

## Maintaining this file

One copy exists, at the monorepo root. (Until 2026-08-31 two byte-identical
copies were mirrored across the LinkSpy and Dashboard repos; the monorepo merge
ended that.)

Re-derive after any change to deployment config by grepping all four app trees:

```bash
grep -rEn "process\.env\.[A-Z0-9_]+" --include=*.ts --include=*.tsx <repo>
grep -rEn "os\.(environ|getenv)" --include=*.py <repo>
```

---

## Client presence chips — endpoints, auth, activation

Merged: LinkSpy PRs #79/#80 (`feat/client-intelligence-linkspy`), Dashboard PR
#8 (`feat/client-intelligence-dashboard`). Both on `main`. Deployed. **Dormant
until `PRESENCE_CHIPS=1` is set on both surfaces.**

### Endpoints (both served by LinkSpy on Railway)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/registry-bridge/client-presence?registry_client_id=<uuid>` | Four chips aggregated over the client's sites, resolved via `sites.client_id` |
| `POST` | `/api/registry-bridge/link-client` | Link a Dashboard client to a registry client. **The only write in this feature** |

**Auth:** qa-bridge service key (`qab_…`), as `Authorization: Bearer <key>` or
`X-Api-Key`. Same key pool as `/api/qa-bridge/status` — hashed at rest,
rate-limited at 120 req/min per key. The Dashboard reads it from
`LINKSPY_API_KEY`; it is server-side only and never reaches a browser.

**The flag gate precedes auth**, so an unauthenticated request is a safe probe
for whether the feature is live:

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  "$LINKSPY_API_URL/api/registry-bridge/client-presence?registry_client_id=test"
```

| Response | Means |
|---|---|
| `404 {"error":"presence_chips_disabled"}` | Deployed, flag **off** |
| `401` | Deployed, flag **on** — auth now required, so supply the key |
| `404 {"detail":"Not Found"}` | Route **not deployed** (different body — read it, don't just read the status) |
| `200 {"chips":[],"site_count":0}` | Flag on, client unknown or has no sites. **A valid empty answer** |
| `200` + `chips` + `sites_summary` | Flag on, client mapped |
| `503 {"error":"presence_chips_unavailable"}` | **A real storage fault.** Never a dormant state — stop and diagnose |

### Activation order

1. **Railway `brokenlinkchecker`** → add `PRESENCE_CHIPS=1` → Deploy → Ready.
   Verify with the unauthenticated probe above: it must flip from
   `404 presence_chips_disabled` to `401`.
2. **Vercel `dashboard`** → add `PRESENCE_CHIPS=1` → Redeploy → Ready.
   Client pages now show four chips or the "Not linked to LinkSpy" strip.
3. **Link one pilot client** (see below). Do not bulk-link — the design note
   explains why 3–5 real clients first, never all 89.

Rollback: unset `PRESENCE_CHIPS` on either surface and redeploy. Written
`registryClientId` values persist deliberately — they are registry annotations,
not feature state.

### Linking a client

**Simplest path — the UI.** Dashboard → client detail → **"Link to LinkSpy"**
on the "Not linked" strip. Leave the id box blank to match by name. It calls the
endpoint below, writes `Client.registryClientId`, and refreshes the page. Prefer
this: it cannot mistype a UUID and it records the same result.

**Manual equivalent:**

```bash
curl -X POST "$LINKSPY_API_URL/api/registry-bridge/link-client" \
  -H "Authorization: Bearer $QAB_KEY" -H "Content-Type: application/json" \
  -d '{"dashboard_client_id":"<dashboard cuid>","name":"<Client Name>"}'
```

| Field | Required | Behaviour |
|---|---|---|
| `dashboard_client_id` | yes | Echoed back; the Dashboard stores the result against it |
| `name` | yes | Used to match an existing registry client |
| `linkspy_client_id` | no | If given, it is **verified to exist** and returned; a bad id is a `404`, never a silent mislink |

Resolution order: explicit id → name match → **create** in the staff workspace.
The response names which happened via `matched_by` (`id` / `name` / `created`)
and `created: true|false`.

Verify a link took: re-run the presence probe with the returned
`linkspy_client_id` — it should return `200` with `site_count > 0` if that
registry client has sites. If it returns `site_count: 0`, the link is real but
the registry client has no sites attached (`sites.client_id`), which is a
registry-hygiene issue, not a linking failure.
