# devicepreview — how it is built

What the pieces are and why each one is there. For what the tool *cannot* tell
you, read `LIMITATIONS.md`. For why Apple profiles are not routed to a Mac, read
`docs/decisions/ADR-003-devicepreview-stops-at-the-honest-label.md`.

---

## Why the capture runs on Linux

A hosting decision, not a preference.

The capture happens **on demand, server-side**: someone opens a page in the
Dashboard, clicks *Run again*, and a machine has to render their client's site
at fourteen viewports. That needs a box that is always on and cheap to keep on
— a Docker container on Railway, and Railway runs Linux.

What makes Linux workable is that Playwright ships headless builds of **all
three engines** for it. One container gets Chromium (Blink), Firefox (Gecko)
and **WebKit — Safari's engine** — which is what makes an `iphone-16` profile
more than a narrow Chrome window.

A macOS host would render Apple's own fonts, and it is not worth it: EC2 mac
instances enforce a 24-hour minimum allocation, MacStadium is a subscription,
and GitHub's free macOS runners are asynchronous CI rather than a service you
can call and wait on. ADR-003 has the measurements behind that decision.

## What one capture actually does

Per device profile, in its own browser context:

1. Apply the profile's **viewport, device pixel ratio, `isMobile`, `hasTouch`
   and user agent** (`devices.json`).
2. Load the page, **scroll the whole document** to trigger lazy loading, then
   wait for images and `document.fonts` to settle. The scroll is not capped at
   a few viewports: two runs seconds apart differed by 1–3% of pixels purely
   from half-triggered lazy images before it scrolled the lot.
3. **Screenshot three ways** — `fold` (first screen), `full` (entire page),
   `thumb`.
4. **Read the DOM** and emit findings. The rules: `tap-small`, `tap-close`,
   `text-small`, `element-wider`, `overflow`, `clipped-text`, `fixed-chrome`,
   `offscreen`, `image-size`, `viewport-meta`, `cls`, `webfont`.
5. Optionally **diff against a stored baseline** to catch regressions.

The audit is the part that needs the DOM, which is why it belongs to the local
backend and not to any screenshot-only service.

## The pieces

### Capture service — this directory, a container on Railway

- **Playwright (Python, ≥1.45)** — engine automation and device emulation;
  takes the captures. Also drives the live sessions, over Chromium's CDP
  screencast (`live.py`).
- **`devices.json`** — the matrix: 15 profiles, each with viewport, pixel
  density, UA, engine and tier. Data rather than code, so adding a handset is
  an edit and not a deploy of new logic.
- **`devicepreview.py`** — the CLI and the whole engine: capture contract,
  audit rules, report writing, baseline diffing. Runnable by hand.
- **`server.py`** — FastAPI + uvicorn, the surface the Dashboard calls:
  `POST /api/devicepreview/run`, then `status`, `report`, `file`, `image`,
  `runs`, and an unauthenticated `/health`. Each run is **the CLI in its own
  subprocess**, so Playwright's sync API stays out of the event loop and a run
  that hangs is killed at `RUN_TIMEOUT_S` instead of taking the service with
  it. `MAX_RUNNING` (default 1) is the admission gate; the rest get `429`.
- **Pillow** — thumbnails, the 900px JPEG derivatives the Dashboard is served,
  and baseline diffing when odiff is absent. Optional: without it captures
  still succeed and say so in a note.
- **odiff** — optional, any binary on `PATH`; faster pixel diffing.
- **Dockerfile** — pins the font set (the single biggest source of garbage
  screenshots on headless Linux), installs all three engines, and **fails the
  build** if proportional text renders monospace. A broken font stack cannot
  ship quietly.

### Storage

- **Prisma + Postgres (Supabase)** — `LayoutSite`, `LayoutRun`, `LayoutShot`,
  `DevicePreviewRun`, `DevicePreviewShot`. The Dashboard keeps the **fold** and
  the findings; full-page captures stay on the service's disk.
- **Railway volume at `/app/runs`** — without it every redeploy deletes every
  capture and the UI falls back to its stored fold. Retention is **per site**
  (`RETAIN_PER_SITE`, default 2), keeping derivatives over originals, so the
  disk scales with the number of sites rather than how often they are checked.
  Steps: `docs/runbooks/devicepreview-volume.md`.

### Interface — `apps/dashboard`

- **Next.js 16 + React 19** — two tabs (an eight-width sweep and the device
  matrix) sharing one stage, so the interaction is learned once.
- **`device-skin.ts`** — the handset silhouettes, in pure CSS, keyed on profile
  id. No photographs of real hardware, so no trademark exposure; a frame can
  never claim to be a device the run did not use.
- **`provenance.ts`** — the permanent line beside the device naming the machine
  that rendered the capture. The frame is a claim; this keeps it honest.
- **Tailwind v4 `@theme` tokens** — one palette, which is what lets
  `contrast.ts` check accessibility as arithmetic rather than by eye.
- **motion** — four transitions, reduced-motion aware.
- **lucide-react**, **geist** — icons and typeface.

### Tests and evidence

- **Python `unittest`** — the audit rules against fixtures. Three
  **calibration gates** run before any detection or capture change; the rule
  and their current state live in the project memory and in commit messages.
- **`node:test` + `tsx`** — geometry and view-model modules are pure functions
  with unit tests; components only draw.
- **Playwright (Node, devDependency)** — browser probes, and
  `scripts/contrast-audit.mjs`, which reads computed colour against computed
  background on the rendered page.
- **`scripts/font-stack-census.py`** — counts pages whose typography follows
  the capturing machine. A page is only *exposed* when the platform face leads
  its stack.
- **GitHub Actions** — `q3-webkit-linux-vs-macos.yml`, the throwaway
  comparison that produced ADR-003's numbers. Free, because the repo is public.

## The shapes worth keeping

- **Data over code.** The device matrix is JSON; so is the reason a profile has
  no real-hardware equivalent.
- **Pure modules, drawing components.** Anything with arithmetic in it —
  crops, pins, verdicts, contrast, provenance — is a tested pure function.
- **Never a false result.** Where evidence is ambiguous the tool warns rather
  than fails, and where it cannot measure something it says so instead of
  inferring. `system-ui` is recorded and deliberately not judged, for exactly
  this reason.
