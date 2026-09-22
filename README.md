# Apexure QA ecosystem

Four apps, three services and one shared contract that together answer a single
question for every page Apexure ships: **is this deliverable actually correct,
and can we prove it to the client?**

Built as a monorepo on 2026-08-31 from three separate repositories, with full
git history preserved — `git log --follow` still works across the moves.

```
                         ┌──────────────────────────────┐
                         │  apps/shell — the front door │
                         │  Google sign-in @apexure.com │
                         └───────────────┬──────────────┘
                    signed HMAC handoff  │  (≤5 min, SPINE_SECRET)
                 ┌───────────────────────┴────────────────────────┐
                 ▼                                                ▼
   ┌──────────────────────────────┐              ┌──────────────────────────────┐
   │ apps/dashboard               │   spine bus  │ apps/linkspy                 │
   │ Deliverables Dashboard       │◀────────────▶│ LinkSpy frontend             │
   │ Next 16 · Prisma · Postgres  │  (HMAC, at-  │ Next.js · NextAuth v4        │
   │                              │  least-once) │                              │
   │ QA · Boards · Layout checks  │              └──────────────┬───────────────┘
   │ Certificates · Insights      │                             │
   └───────┬──────────────────────┘                             ▼
           │                                   ┌──────────────────────────────┐
           │  HTTP (keyed)                     │ services/linkspy-api         │
           ├──────────────────────────────────▶│ FastAPI · Playwright         │
           │                                   │ scans · monitoring · jobs    │
           │                                   └──────────────────────────────┘
           │        ┌──────────────────────────┐   ┌──────────────────────────┐
           └───────▶│ services/devicepreview   │   │ services/pagecheck       │
                    │ 15-profile render matrix │   │ pre-launch page verdict  │
                    └──────────────────────────┘   └──────────────────────────┘
```

| Path | What it is | Runs on |
|---|---|---|
| `apps/dashboard` | Deliverables Dashboard — clients, projects, pages, QA, boards, certificates, insights | Vercel |
| `apps/linkspy` | LinkSpy frontend — link and attribution scans, monitoring | Vercel |
| `services/linkspy-api` | LinkSpy backend — crawling, monitoring, jobs, self-heal | Railway |
| `apps/shell` | The door page — one Google sign-in, signed handoffs onward | Vercel |
| `services/devicepreview` | Cross-device render matrix and layout audit | CLI / Railway |
| `services/pagecheck` | Single-page pre-launch checker | CLI / local UI |
| `apps/linkspy-extension` | Browser extension | — |
| `packages/qa-tokens` | Shared design tokens | — |

**811 commits · ~162,000 lines across 981 tracked files · 2,151 automated tests.**
Five months, from first commit to here.

---

## The Deliverables Dashboard

The tool the QA team works in all day. Ten sections, each backed by real data
rather than a spreadsheet tab.

| Section | What it answers |
|---|---|
| **Overview** | What's in flight, what's late, what's failing — issues by severity, the delivery pipeline at a glance |
| **Monthly** | Every page QA'd this month, per-developer on-time delivery, defect counts by client, CSV export |
| **Clients** | Client → Project → Page drill-down with inline editing throughout |
| **Sites** | Live LinkSpy status per site: broken links, attribution, consent, Core Web Vitals |
| **Layout checks** | How a page renders across a device matrix, defects pinned, 3D handset models, before/after run diffs |
| **Boards** | Trello-style QA ↔ developer issue tracking with a developer portal |
| **Team** | Per-person workload and quality, logins, roles and ranks |
| **Checklists** | Reusable QA templates scoped per platform, seeded onto new pages |
| **Candidates** | Checklist items the system proposes from real production findings |
| **Insights** | Cross-client and per-developer quality trends, deconfounded |

A **⌘K command palette** jumps to any client, project or page. Filters are
instant, status changes are inline, and every table exports to CSV.

---

## Insights — measuring people without lying about them

The hardest part of the system, and the part most QA tooling gets wrong. Defect
counts look like a measure of the developer. They are not: they are a measure of
the developer *and* whoever reviewed the page. A strict tester makes a good
developer look careless.

Three mechanisms carry the honesty, and all three are enforced by the shape of
the data rather than by discipline.

**Deconfounding.** Each tester's defect rate is computed relative to the mean,
and developer numbers are adjusted for who reviewed them. `MIN_TESTER_PAGES`
gates which testers have reviewed enough pages to adjust anybody, and below
three distinct reviewers the result is downgraded to *indicative* rather than
presented as a control.

**A ranking floor.** Below five pages, a cell renders as **withheld** — hatched,
with its `n` visible. Never blank, which reads as "did no work". Never zero,
which reads as "perfect".

**Explicit blocking.** A metric with no field behind it renders as **blocked**,
with a sentence saying why. The module refuses to filter on `Issue.status`
at all, because in this database status encodes which import epoch a row came
from rather than a lifecycle — *a metric that filters on status is measuring the
calendar*, so the field is not exposed to the metric layer in the first place.

Severity weighting exists, and the code says plainly that it is very nearly the
identity function today, because severity is 98.7% `LOW`.

---

## Boards and the developer portal

Five stages — New → Active → Discussed → Completed → Closed — built on the
existing `Issue` table rather than a parallel model. `boardStage IS NULL` means
"not on a board", which is how ~2,300 historical page-review issues stayed
untouched through the migration.

**Two views, one model.** QA works through the app with a session. A developer
reaches exactly one board through a **capability link** — no login, no navbar,
no route into the rest of the app. What crosses to them is controlled by
`developerView()`, which is a **whitelist**: it names the ten fields that may
leave the server, so a field added to `Issue` later is hidden by default rather
than leaked by default. Severity and the recurring flag never cross. Priority
arrives as card order alone.

**Moving a card into Discussed requires a written reason**, enforced server-side,
stored as a comment so the writer and the reader share one shape.

**Every metric comes from the event log.** `IssueEvent` holds one row per stage
change with its actor, so cycle time, bounce-backs, recurring count and assigned
vs closed are derived rather than stored — and stay attributable after the fact.
They are shown per developer per month **beside** the delivery view, never
blended into a single score, because a composite is the fastest way to make a
measurement meaningless.

Also on a card: paste a screenshot to create it with that image as its cover; a
card back with cover banner, inline title and description, attachments; one
chronological feed interleaving comments with stage changes — no separate
activity table, because `IssueEvent` already is one; `@mentions` scoped to the
card's two people and stored as structured rows rather than re-parsed from text;
start and due dates with reminders; and unread state, presence dots and typing
indicators, all **derived rather than stored**, so nothing has to be marked read
and no flag can drift.

Boards archive without detaching anything, and come back the same way.

---

## QAlert — Slack that actually reaches the person

Board mentions and due-date reminders arrive as a **direct message to the
developer**, through a bot token.

This is deliberate, and it was a bug first. An incoming webhook is permanently
bound to the one conversation it was created for — a `<@U…>` in the text renders
as a highlighted name, but if that person isn't in that conversation they are
notified of nothing. Every board mention was landing in one person's self-DM.

So QAlert prefers a real DM, falls back to a webhook when that's all there is,
and **records which was used**. It never throws. `IssueMention.notifiedAt`
doubles as an outbox: null means Slack did not confirm delivery, and that is
visible and retriable rather than swallowed. Two traps are handled explicitly —
`chat.postMessage` answers HTTP 200 with `{ok: false}` on refusal, so the status
alone would report a silent failure as success; and Block Kit blocks go to the
DM path only, because the webhook's degraded one-line form carries the mention
that is the only thing that notifies anyone.

---

## Layout checks — a render matrix, not a screenshot

**Fifteen device profiles across all three browser engines** — Chromium/Blink,
Firefox/Gecko and WebKit — from iPhone 17 Pro Max and iPad Pro 13 through Galaxy
S25 Ultra, Galaxy Z Flip open and cover, Xiaomi 15 and desktop-1440. Twelve
geometry rules run inside the page: overflow, viewport-edge violations, clipped
content, overlap. Webfont delivery and layout shift are recorded per capture.

Each capture is drawn inside a **per-handset 3D model** with findings pinned to
where they occur, a scroll ruler, and before/after diffs between runs.

**Three swappable backends behind one interface.** `local` runs Playwright
headless; `macos` runs the same code on a Mac, where WebKit draws Apple's real
system fonts; `browserstack` fetches real-device screenshots through
BrowserStack's REST API. The caller never knows which one served a capture —
the result shape is identical.

**The house rule is that it never returns a false FAIL.** When evidence is
ambiguous it warns and stops at the honest label rather than guessing. Twelve of
the fifteen profiles carry `verified: false` — their viewport, scale factor and
user agent come from published specifications and have not been checked against
physical hardware — and the report footer says so, every time. The service ships
a `LIMITATIONS.md` that opens: *read this before citing a result to a client.*

---

## AI QA — suggested fixes and severity, with a hard boundary

"Run AI QA" on a page combines a **deterministic layer** — HTTPS, load time,
page weight, favicon, SEO title and description, Open Graph tags, H1, analytics
and pixel presence, copyright year, sitemap — with a **judgment layer** on
Claude that reads the page for spelling, privacy-policy presence and CTA
quality, then **drafts issues with a suggested fix and a severity ranking** that
a human accepts or discards.

The boundary is absolute and enforced by a test, not by agreement: **machine
writes never land unattended in the human checklist tables.** The flywheel
isolation test asserts that nothing on the AI path can write `QACheckItem` or
`QACertificate`, that promotion requires a non-empty rationale server-side, and
that the only writer of a checklist item is a human pressing promote.

The judgment layer activates only when `ANTHROPIC_API_KEY` is set. Without it,
every deterministic result still returns — the feature degrades rather than
disappearing.

---

## The client-facing QA certificate

Every page can publish a certificate at `/c/<shareId>`: checklist categories,
their results, and a verdict, readable by a client holding a link. There is a
client portal per account and an embeddable trust badge.

It is **living**. Rather than freezing a PDF at hand-off, it re-verifies against
LinkSpy and shows the client a health timeline — so the claim stays true after
delivery or visibly stops being true.

Because anyone holding the link can reach it, this is the most tightly
constrained path in the repo. An isolation test encodes seven invariants, among
them: the path is **read-only**, so an anonymous visitor cannot make the database
do work on request; it is **page-scoped**, so a page token can never reveal a
client's whole estate; LinkSpy's raw internal payload may never appear as a
selected key; no signed handoff link may be emitted; no second token may be
minted; and the feature flag must be checked *before* the database read.

---

## The flywheel

A production incident that had no delivery check arrives from LinkSpy over the
event bus, lands in a candidates inbox, and appears for a human to promote or
dismiss. Promotion requires a written rationale and adds the check to the
template — so the next deliverable inherits a lesson learned from a real
failure, while pages whose certificates a human already signed stay untouched.

---

## Team, roles and personalization

One row per person: what work they do, what access they hold, what they have
built or QA'd. Three groups — Management, QA, Developers — each showing only the
columns that mean something in it.

**Two independent axes, deliberately.** `role` is the work a person does;
`rank` is how far they can move around the app. They are separate because they
answer different questions — a senior and a junior developer do the same work
and need not have the same access, and collapsing the two would force you to
make someone a "tester" to restrict them, which would then corrupt the QA
assignment data. `VIEWER` holds no capability at all, read-only by construction
rather than by a list of exceptions. An unknown rank from the database resolves
to `VIEWER` — unknown fails closed, never open.

Who does which work is a **whitelist**, because the blacklist form cost the same
bug twice: `role !== "TESTER"` reads like "developers" right up until a fourth
role is added, at which point every new role is silently a developer.

Per-person logins with scrypt password hashes, avatars, a dark mode and custom
themes, and per-person preferences throughout. Deactivating someone invalidates
their session on the next request rather than waiting for cookie expiry.

---

## How the pieces stay honest

This is the part worth reading twice. Every mechanism below is enforced by a
guard, a test or a type — never by a convention somebody has to remember.

**One database, no point-in-time recovery.** Both Supabase projects are free
tier. Everything below follows from that.

- **Destructive commands fail the build.** `prisma db push` and `--force-reset`
  are banned by ADR-001, and `guard:db` runs as `prebuild` — so any build fails
  if one is reintroduced. The guard assembles the banned strings from fragments
  so it can never trip on itself. DDL is additive only; every migration carries
  `REVERSIBILITY:` and `DATA AT RISK:` footers; a verified `pg_dump` precedes
  every one, recorded by filename and byte count.
- **A new API route cannot ship unguarded.** An isolation test walks every route
  file and fails on any that isn't classified as session-guarded,
  service-guarded or public-by-design — *an unlisted route is an unguarded
  route*. It goes further: it asserts the guard runs **before** any database or
  key access, strips comments first so prose position can't decide the
  assertion, and pins the middleware matcher so nobody can widen it and assume
  the guards are now redundant.
- **Nothing contaminates what it measures.** Scanning a client's page used to
  fire that client's analytics — a `<noscript>` pixel fallback fetched on every
  scan, writing a PageView into the client's own reporting. The first fix was a
  guard at the call site. The real fix was removing the need to remember: no
  module creates a browser context of its own, every one comes from a single
  place with collector endpoints already refused, and a test fails the build if
  a new caller creates one directly. Opting out is possible and deliberately
  awkward — it takes a **written reason, not a boolean** — and exactly one file
  uses it, because recording third-party requests under each consent state is
  the whole measurement there.
- **Duplicated contracts are checksum-guarded.** The spine envelope and the
  handoff token exist in both TypeScript and Python. Each copy carries a sha256
  of the canonical spec and the tests fail when the copies drift — because a
  field added on one side and not the other produces envelopes that verify but
  deserialize wrongly, the hardest class of integration bug to find.
- **Capability links, not accounts.** A certificate and a board are each reached
  by a random token on the row — minted behind a permission, nulled to revoke,
  404 on any miss so it cannot be probed.
- **Attribution or null, never a guess.** The shared team password has no person
  behind it, so it records null — visibly, rather than attributing to nobody in
  particular.
- **Delivery is confirmed before state advances.** An alert marks itself sent
  only after the channel confirms; a failed sweep is retried by the next one,
  never counted as success. This exists because a domain-expiry alert once had
  six ways to reach nobody, all of them silent.
- **The contrast ratchet runs both ways.** It measures every colour token used
  as text against every surface the app actually paints — including tinted
  surfaces that aren't tokens at all — and a known-failure entry that has been
  fixed must be deleted, so the exemption list can never rot into an excuse.
- **Secrets can't reach the browser.** Isolation tests assert that every module
  holding a key carries `import "server-only"`, that no client component
  references one, and that client-safe modules never import a server-only client
  — which would drag the secret into the client graph.
- **CSV cells beginning `= + - @` are neutralised** before export, but only when
  non-numeric, so a real `-3` stays a number.

---

## Testing

| Suite | Count | Command |
|---|---|---|
| Dashboard unit — pure logic, no DB, no clock | **841** | `cd apps/dashboard && npm test` |
| Dashboard end-to-end (Playwright) | 17 specs | `npm run e2e` |
| LinkSpy backend | **1,155** | `cd services/linkspy-api && pytest tests/` |
| devicepreview | **96** | `cd services/devicepreview && python -m unittest discover -s tests` |
| Shell | 43 | `node --test lib/**/*.test.ts` |

Non-trivial logic lives in **pure modules outside React and Prisma** — scoring,
whitelists, feed ordering, reminder windows — so it can be tested without a
database or a clock. No module reads the clock; `now` is passed in.

Beyond the counts, one standard that isn't a test: anything touching uploads or
rendered UI is verified against a **production build**, with real screenshots at
1280 and 390 that a human looks at — because DB and DOM assertions have twice
been green while the picture was broken.

---

## Getting started

There is no root workspace. Each app owns its `package.json` and lockfile.

```bash
# Dashboard — the usual starting point
cd apps/dashboard
npm install
cp .env.example .env          # DATABASE_URL, DIRECT_URL, APP_PASSWORD, AUTH_SECRET
npm run db:migrate            # never `db push` — see ADR-001
npm run dev                   # http://localhost:3000

# LinkSpy backend
cd services/linkspy-api
pip install -r requirements.txt && playwright install chromium
uvicorn main:app --reload --port 8000

# devicepreview
cd services/devicepreview
python devicepreview.py https://example.com/ --tier all
open runs/<timestamp>/report.html
```

Prisma needs `?sslmode=require` in the Supabase URL — it ignores `PGSSLMODE`,
and without it `migrate deploy` hangs for ten minutes and then reports a
connection error that reads exactly like an outage, on a host that is up.

**What degrades gracefully when unconfigured**, by design: no
`ANTHROPIC_API_KEY` means the AI judgment layer is skipped and deterministic
results still return; no LinkSpy keys mean the Sites section is silent; no
devicepreview key means that section is silent; no Slack credentials mean
mentions are stored with `notifiedAt` null **and the app says so**.

---

## Where the answers live

| File | What it settles |
|---|---|
| `INFRASTRUCTURE.md` | Every deployment surface, env var, shared secret and feature flag, plus the open-defect register. Updated in the same PR as any deployment-config change. |
| `CLAUDE.md` | Working agreements: conventions, invariants, the rules above stated where they bind. |
| `docs/decisions/` | ADRs — why migrations are additive, what Run AI QA does, where devicepreview stops and why, why the 3D frame is internal-only. |
| `docs/runbooks/` | Backups, the devicepreview volume, the living certificate. |

---

## Stack

**TypeScript** — Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4,
Prisma 6, motion, three.
**Python** — FastAPI, Playwright, Supabase.
**Data** — PostgreSQL ×2.  **Hosting** — Vercel ×3, Railway ×1.
**AI** — Claude via `@anthropic-ai/sdk`, for the QA judgment layer.

## Conventions

- Server Components by default; mutations are server actions colocated with the route.
- Design tokens, never raw hex. Sentence case in UI copy; no "easily / simply / just / powerful".
- Enum-like columns are `String` with the values in `constants.ts`, so adding one is a code change rather than a migration.
- New dependencies are a conversation, not a commit.
