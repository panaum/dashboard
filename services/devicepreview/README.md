# devicepreview

How a URL renders across a fixed matrix of device profiles, with layout
defects flagged automatically and a self-contained gallery to read the
result. One Python file, Playwright's three engines, no server.

```bash
cd services/devicepreview
../pagecheck/.venv/bin/python devicepreview.py https://example.com/ --tier all --include-edge
open runs/<timestamp>/report.html
```

Read `LIMITATIONS.md` before quoting a result to a client.

## Install

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # playwright + pillow
playwright install --with-deps chromium firefox webkit
python devicepreview.py --self-check     # renders a font test page in all three engines
```

Pillow is required for thumbnails and for `--baseline` diffing. `odiff` is
optional and faster for diffing: any `odiff` on PATH is used, or pass
`--odiff "npx -y odiff-bin"`.

The `Dockerfile` installs the fonts headless Linux needs and fails the build
if proportional text comes out monospace. Never add Apple's San Francisco
fonts to it — the licence does not permit it.

## Running

```
devicepreview <url> [options]
  --devices iphone-16,galaxy-s25      comma list of ids, or 'all'
  --tier primary|all                  default: primary
  --include-edge                      include edge-tier profiles (the 260px Z Flip cover screen)
  --landscape                         rotate every profile
  --color-scheme light|dark|both      default: light
  --backend local|macos|browserstack  default: local
  --baseline <dir>                    diff each capture against a previous run directory
  --ignore-regions "<sel>,<sel>"      mask these selectors before diffing
  --diff-threshold <pct>              regression threshold, default 0.1 (% of pixels)
  --odiff <cmd>                       odiff binary or command; default: odiff on PATH, else Pillow
  --concurrency <n>                   parallel engines; default min(cpu, 4)
  --timeout <seconds>                 navigation / network-idle, default 30
  --max-scroll-viewports <n>          lazy-load scroll cap, default 40
  --disable-rule <rule,rule>          switch audit rules off for this run
  --out <dir>                         default: ./runs/<timestamp>
  --json                              print the report.json path only
  --list-devices                      the matrix, with unverified profiles marked
```

Exit codes: `0` clean, `1` any error-severity finding or a visual regression,
`2` a capture failed or was blocked by bot protection. Failure wins: a run
that could not capture vouches for nothing.

A `devicepreview.config.json` beside `devices.json` may switch rules off
permanently: `{"rules": {"tap-close": false}}`. Unknown rule names are an
error, not a silent no-op.

## What a run produces

```
runs/<timestamp>/
  report.json            the machine-readable contract (schemaVersion 1)
  report.html            one self-contained file: gallery, detail, compare, diffs
  <profile-id>/
    fold.png             above the fold, at the device's pixel density
    full.png             the whole page, clipped at the viewport width
    thumb.png            for the gallery
    diff.png             with --baseline: changed pixels in red over the greyed baseline
```

`report.json` holds run metadata (`url`, `startedAt`, `backend`, `tool`,
`options`, `timing`, `host`), a `summary` (errors, warnings, devices passed /
failed / blocked / regressed), and one entry per capture with `status`
(`ok` | `failed` | `blocked`), `findings[]` (`severity`, `rule`, `message`,
`selector`, `box`, and `scope: "page"` for document-level findings),
`images`, `timings_ms`, `fonts` (faces, measured stacks, requests, failed
requests), `page` (title, dimensions, user agent, CLS), `notes[]`, and
`diff` (null without a baseline). Image paths are relative to the run
directory, so a run folder can be zipped and opened anywhere.

## Baseline diffing

```bash
python devicepreview.py https://example.com/ --out runs/before
# ... the developer ships a fix ...
python devicepreview.py https://example.com/ --out runs/after --baseline runs/before
```

Each capture is compared with the same profile, colour scheme and
orientation in the baseline. The detail view shows the percentage changed,
the diff image, and **where** the change is (the containers holding it, by
share), with the selector to pass to `--ignore-regions` if it is dynamic by
design. It also says when the page height changed and when the two runs drew
text in different fonts. Two runs of a stable page differ by 0.0 %.

## Backends

- `local` — Playwright's bundled engines, headless, in this process. One
  browser per engine, a fresh context per profile. Fast, free, no quota.
- `macos` — the same code on a Mac, where WebKit uses Apple's real font
  stack, so `-apple-system` is authentic and the substitution note is not
  emitted. Refuses to run elsewhere.
- `browserstack` — physical devices through BrowserStack's Screenshots REST
  API (not WebDriver). Needs `BROWSERSTACK_USERNAME` and
  `BROWSERSTACK_ACCESS_KEY` (or `BROWSERSTACK_KEY` as `user:key`) and a plan
  that includes the Screenshots API. One job per run, polled to completion,
  images laid out like a local run. No DOM, so no findings — see
  `LIMITATIONS.md`.

The result shape is identical across backends; a reader of `report.json`
never needs to know which one ran.

## Adding a device

Add a profile to `devices.json`:

```json
{
  "id": "pixel-9", "label": "Pixel 9", "engine": "chromium", "platform": "android",
  "tier": "primary", "playwrightDevice": "Pixel 7",
  "viewport": {"width": 412, "height": 923}, "deviceScaleFactor": 2.625,
  "isMobile": true, "hasTouch": true, "userAgent": null, "verified": false,
  "browserstack": {"os": "android", "os_version": "15.0", "device": "Google Pixel 9"}
}
```

- `playwrightDevice` names a Playwright descriptor whose fields are spread
  first; explicit fields override it, so user agents track Playwright's
  updates instead of rotting here. `userAgent: null` means the descriptor's,
  or the engine's default for desktops (Chromium's is read from the running
  browser with "HeadlessChrome" renamed, because Cloudflare walls that word).
- Leave `verified: false` until the numbers have been checked against the
  physical device; the report footer names unverified profiles.
- `browserstack` is the Screenshots API mapping (`os`, `os_version`,
  `device`; for desktops `os`, `os_version`, `browser`, `browser_version`),
  or `null` if BrowserStack does not offer the device.
- `tier: "edge"` profiles run only with `--include-edge`.

## Adding an audit rule

1. Add the rule to `DEFAULT_RULES` in `devicepreview.py`.
2. Add its block to `AUDIT_JS`, guarded by `rules['<name>']`, using the
   helpers declared above the first rule (`vis`, `sel`, `box`, `snippet`,
   `clippedBy`, `inSlider`, `textRects`, `ownText`). Push findings as
   `{severity, rule, message, selector, box}`; use `selector: 'html'` /
   `'body'` for document-level findings (they are listed, not drawn).
3. Write `fixtures/<name>.html` that triggers exactly this rule and nothing
   else, and a test in `tests/test_audit.py` that asserts both directions:
   the rule fires there, and no other rule does. The second half is what
   catches regressions.
4. Decide the severity by the rule of the house: **never a false FAIL**.
   `error` only for something a visitor cannot miss (the page scrolls
   sideways, a font file is missing); `warn` when the evidence is real but the
   impact is arguable; `info` for fidelity notes. When evidence is ambiguous,
   warn and say "check the screenshots".
5. Run the suite, then the live gates before committing: the pages named in
   the commit history must keep reporting what they report. A rule that
   starts firing on a page it used to ignore is a false positive nobody
   asked for.

## Running as a service (what the Dashboard talks to)

`server.py` wraps the CLI in the same start → poll → fetch shape the LinkSpy
service uses, so the Dashboard can drive it the way it drives Layout checks.
Each run is the CLI in its own process; a run that hangs is killed at
`RUN_TIMEOUT_S`. The `Dockerfile` starts it.

```bash
DEVICEPREVIEW_KEY=$(openssl rand -hex 24) ../pagecheck/.venv/bin/python server.py   # http://localhost:8000
```

| Variable | Meaning | Default |
|---|---|---|
| `DEVICEPREVIEW_KEY` | The service key callers must present (`Authorization: Bearer` or `X-Api-Key`). Unset ⇒ every request is refused with 503 | — |
| `RUNS_DIR` | Where runs are kept. Mount a persistent volume here on Railway or galleries vanish on redeploy | `./runs` |
| `RETAIN_PER_SITE` | Runs kept per URL, newest first; the rest are deleted after each run. Only the newest run of a URL keeps its PNG originals and gallery; the older kept runs hold their report and JPEG derivatives | `2` |
| `DERIVATIVE_WIDTH` / `DERIVATIVE_QUALITY` | Width and JPEG quality of the derivative made of every capture when a run completes | `900` / `82` |
| `RUN_TIMEOUT_S` | Hard stop for one run | `900` |
| `DEVICEPREVIEW_CONCURRENCY` | Engines run in parallel inside a run; lower it on a small instance | `2` |
| `MAX_RUNNING` | Runs accepted at once; more get `429 run_capacity` | `1` |
| `LIVE_TOKEN_TTL_S` | How long a live-session token may be used to open a session | `120` |
| `LIVE_IDLE_TIMEOUT_S` | No input for this long and the browser is closed | `180` |
| `LIVE_MAX_SESSION_S` | Hard ceiling on one live session | `900` |
| `LIVE_MAX_FPS` / `LIVE_QUALITY` | Frame cap and JPEG quality for a live session | `20` / `60` |

```
POST /api/devicepreview/run      {url, devices?: [...] | "all", tier?, include_edge?, landscape?,
                                  color_scheme?, ignore_regions?: [...], baseline?: run_id, timeout?}
                                  → {run_id, status: "running", baseline?, baseline_missing?}
GET  /api/devicepreview/status   ?run_id=   → {status: running|finishing|done|failed, progress{done,total,message}, summary, exit_code, error, originals}
GET  /api/devicepreview/report   ?run_id=   → report.json
GET  /api/devicepreview/file     ?run_id=&path=report.html | <profile>/full.png | <profile>/diff.png …
GET  /api/devicepreview/image    ?run_id=&profile=&kind=fold|full|thumb|diff&max_width=1400   → JPEG, downscaled
GET  /api/devicepreview/runs     ?url=      → retained runs for that page, newest first
GET  /health                                → {ok, running, retained, configured, runs_dir, retain_per_site}
WS   /api/devicepreview/live-session ?token=  → a real browser, streamed (Chromium profiles)
```

`status` reports `done` whenever a report was written, with the CLI's exit
code alongside (0 clean, 1 errors or regressions, 2 a capture failed or was
blocked) — the report says which device and why. `failed` means no report at
all. `finishing` is the moment between the report and `done`, while the
derivatives are written and the site's older runs are pruned; a caller that
sees `done` can rely on what is on disk.

Retention is **per site, and keeps the derivative**. After every run the
service sorts that URL's runs newest first, deletes all but `RETAIN_PER_SITE`
of them, and strips the PNG originals and `report.html` from every kept run
but the newest — so one page checked hourly cannot evict another page's
latest run, and the disk grows with the number of sites, not with how often
one is run. `originals: false` on `status` says a run has been stripped:
`image` still serves its JPEG derivatives at any `max_width` up to
`DERIVATIVE_WIDTH`, `file` answers 404 for its PNGs and gallery, and it can no
longer serve as a `baseline` (diffing reads PNGs, so only the newest run of a
URL can). Tests: `../pagecheck/.venv/bin/python -m unittest tests.test_server`.

### Live sessions

A capture answers "what did this page look like". A live session answers "let
me use it": a Chromium context with the profile's real viewport, density, user
agent and touch, streamed out as JPEG frames, with taps, scrolls and keys
forwarded back in. A tap arrives at the page as `pointerdown` / `touchstart` /
`touchend` — the thing an iframe can never do.

The browser cannot hold the service key, so the Dashboard signs a short-lived
token that **pins the url and the profile**. The service reads both from the
token and never from the query string, so a token opens exactly one page on one
profile and can never be used to browse elsewhere. It is also:

- **sent as the socket's first message, never in the URL** — uvicorn writes
  query strings to the access log in full, and Railway keeps those, so a token
  in the URL is a token on disk;
- **single use** — signature and expiry alone left a two-minute window in which
  anything that saw the token could open session after session. A spent
  signature is remembered until it expires, and a second use is refused with
  `token_spent`. Each token carries a nonce, so two people opening the same
  page in the same second get different tokens;
- **valid for 120 seconds**, and only to *open* a session. Once open, the
  session runs under its own idle and hard limits.

Runs and sessions **share one slot**: a live session refuses while a capture is
running, and a capture returns `429 run_capacity` while a session is open.
Without that, an instance could hold an audit's three engines and a live
Chromium at once. Closing the tab ends the session — the browser is released
within a fraction of a second, not at the idle timeout.

Chromium profiles only. WebKit and Firefox have no frame-streaming API — a
screenshot loop measured 20fps and is the obvious second slice — and a session
on one of those is refused by name rather than quietly served as something
else. The stream is change-driven: a still page sends nothing, and an input
comes back as a frame in about 50ms. One session at a time.

## Tests

```bash
../pagecheck/.venv/bin/python -m unittest tests.test_audit        # ~2 minutes, all three engines
../pagecheck/.venv/bin/python -m unittest tests.test_audit -k Baseline
```

Every rule has a fixture that triggers only it; the harness runs the real
CLI end to end and fails loudly if a capture's `status` is not `ok`, so a
crash inside the probe cannot masquerade as "no findings". The integration
test runs the whole fifteen-profile matrix against a local page and pins
the report's shape. BrowserStack is tested against a fake of its documented
API; the macos backend is tested live on a Mac and skipped elsewhere.
