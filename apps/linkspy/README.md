# LinkSpy — frontend

The web app for LinkSpy: scan a page, read the report, watch a site over time,
and hand a client something they can act on. Talks to
[`services/linkspy-api`](../../services/linkspy-api), which does the crawling.

Part of the [Apexure QA ecosystem](../../README.md) monorepo. Deployed on Vercel
as the `brokenlinkchecker` project.

## Screens

| Route | What it is |
|---|---|
| `/` | Paste a URL, watch the scan stream in, read the report |
| `/scanner` | The scan surface in full |
| `/dashboard` · `/dashboard/[siteId]` | Monitored sites: status, history, drift |
| `/clients` | Client view of monitored sites |
| `/issues` | Findings across sites |
| `/reports/[report_id]` | A saved report |
| `/r/[token]` | Shareable read-only report — a capability link, no login |
| `/attest/[token]` · `/attestations/[id]` | Attestation flow |
| `/portal` · `/portal/accept` | Client portal and invitation acceptance |
| `/self-heal` | Proposed fixes and the PRs opened for them |
| `/handoff` | Accepts a signed token from the shell — no second sign-in |

## Stack

**Next.js** (App Router) · **TypeScript** · **Tailwind CSS v4** ·
**NextAuth v4** · framer-motion · recharts · cmdk · jspdf + html2canvas (PDF
export).

> NextAuth **v4** reads `NEXTAUTH_SECRET`. An `AUTH_SECRET` set on this project
> is inert — see INFRASTRUCTURE.md.

## Local dev

```bash
npm install
npm run dev        # http://localhost:3000
```

Point it at a backend (locally: `cd services/linkspy-api && uvicorn main:app
--reload --port 8000`). Environment variables, shared secrets and the exact
per-project settings are in [`INFRASTRUCTURE.md`](../../INFRASTRUCTURE.md) —
that file is the single source of truth, not this README.

## Contracts

Two things here are not free to change alone:

- **The frontend contract** with the backend —
  [`docs/linkspy/FRONTEND-CONTRACT.md`](../../docs/linkspy/FRONTEND-CONTRACT.md).
- **The handoff token** from `apps/shell`, whose spec is duplicated in
  TypeScript and Python and guarded by a checksum in both. Change every copy or
  none.

Design standards for this app: [`docs/linkspy/DESIGN-STANDARDS.md`](../../docs/linkspy/DESIGN-STANDARDS.md).
Architecture: [`docs/linkspy/architecture.md`](../../docs/linkspy/architecture.md).
