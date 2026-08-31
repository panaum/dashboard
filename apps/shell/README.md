# Apexure Platform — the Shell

The **sign-in-once front door** for the Apexure QA ecosystem. Three doors, two
live, one placeholder. The shell owns **nothing but identity + navigation** — it
never duplicates functionality from the two apps.

- **Deliverables** → the QA Dashboard (checklists, delivery, team ops)
- **LinkSpy** → broken links, monitoring, production verification
- **Board** → *coming soon* (issue tracking / dev workflow — deferred, ARCHITECTURE v7 §11.1)

## How it works

1. Staff sign in with their **@apexure.com Google account** (NextAuth, JWT — the
   shell stores no data). Non-apexure emails are rejected server-side.
2. Clicking a live door hits `GET /go/<app>`, which **signs a short-lived HMAC
   handoff token server-side** (`SPINE_SECRET`, ≤5-min, same Phase-4 contract) and
   302-redirects to that app's `/handoff?token=…`. The destination verifies the
   token and forwards — **no second sign-in**. `SPINE_SECRET` never reaches the client.

## Stack

Next.js 14 (App Router) · Tailwind · NextAuth (Google). No database.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3000
```

## Env vars (dev `.env.local` / prod Vercel project)

| Var | What |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Same Google OAuth client as the Dashboard. Add `https://<shell>/api/auth/callback/google` to its redirect URIs. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | canonical URL of the shell (`https://<shell-domain>`) |
| `SPINE_SECRET` | **exact same value** as the Dashboard + LinkSpy `SPINE_SECRET` |
| `DASHBOARD_URL` | `https://dashboard-nine-pi-19.vercel.app` |
| `LINKSPY_URL` | `https://brokenlinkchecker-olive.vercel.app` |

## Deploy (Vercel)

1. Create a **new Vercel project** from this repo (separate from the two apps).
2. Add all env vars above (set `NEXTAUTH_URL` to the deployed domain).
3. In Google Cloud → the OAuth client → add the shell's
   `…/api/auth/callback/google` redirect URI.
4. Deploy.

## Making the Board door live (later — < 10 lines)

1. Add `BOARD_URL` env var.
2. `app/go/[app]/route.ts`: add `board: process.env.BOARD_URL` to the `DEST` map.
3. `app/page.tsx`: on the Board `<DoorCard>`, drop `disabled`/`badge`, set
   `href="/go/board"`, `cta="Open Board"`, and (optionally) `accent` to its color.

That's it — the third app just needs its own `/handoff` verifier (same shared
contract) to receive the token.
