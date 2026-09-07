# devicepreview — what it cannot tell you

Read this before citing a result to a client. Every item here is a thing the
tool measured, tried, or learned the hard way; none is hypothetical.

## Engines, not devices

- The `local` and `macos` backends run real browser **engines** (Chromium /
  Blink, Firefox / Gecko, WebKit) with each profile's viewport, pixel density,
  touch and user agent emulated. Layout, breakpoints, CSS support and overflow
  behaviour are accurate. Font rasterisation, native scroll physics, momentum,
  rubber-banding and OS-level animation timing are not.
- WebKit on Linux (and Playwright's WebKit on macOS) is closely related to
  Safari but is not byte-identical to Safari on iOS, and lags real iOS Safari
  on some features.
- Apple's system fonts are **substituted** on Linux. A page that asks for
  `-apple-system` / SF Pro gets an `info` finding saying so. For authentic
  Apple typography run `--backend macos` on a Mac; the San Francisco fonts are
  not installed in the container because the licence does not permit it.
- Vendor browsers and in-app webviews (Samsung Internet, Xiaomi's Mi Browser,
  Instagram, Facebook) cannot be reproduced by emulation. Use
  `--backend browserstack` when a client reports a bug specific to one.
- Twelve of the fifteen profiles carry `verified: false`: their viewport,
  scale factor and user agent come from published specifications and have
  not been checked against the physical device. The report footer names
  them. Confirm against hardware before quoting a figure.

## The BrowserStack backend

- Screenshots come from physical devices, so pixels, fonts and vendor
  browsers are real — and that is **all** you get. The Screenshots API
  exposes no DOM, so a BrowserStack capture has no audit findings, no webfont
  verdicts, no layout shift, no change attribution. Run the local backend for
  those; use BrowserStack for the pixels.
- Desktop screenshots come at BrowserStack's fixed resolutions (Windows
  1280×1024, macOS 1920×1080), not the 1440×900 the desktop profiles specify.
- There is no dark colour scheme; `--color-scheme dark` captures the light
  rendering and says so.
- Device names on BrowserStack drift. Each mapping in `devices.json` is
  checked against their live list at run time: an exact match is used, the
  same device on its latest non-beta OS is used with a note, and an unknown
  device is skipped naming the closest ones. Galaxy Z Flip and Xiaomi are not
  offered there.
- The backend has been tested against a faithful fake of the documented API.
  It has not yet been run against a live account.

## What the audit rules are

- They measure **geometry**, not taste. A tap target under 24 px (WCAG 2.5.8
  AA) or text under 12 px on a phone is reported; whether a layout is ugly is
  not. A run with zero findings means nothing the rules measure is wrong —
  look at the capture anyway.
- Off-canvas and hidden elements are ignored on purpose (an off-screen menu
  once produced thirty tap-target findings for links nobody could see).
  Content inside carousels, sliders, marquees and tickers is excluded from
  the geometry rules: they are meant to overflow.
- Layout shift (CLS) is Chromium-only; WebKit and Firefox report `null`, and
  the rule says "not measurable" rather than a fake zero. It is measured from
  navigation through the tool's own settle-and-scroll pass (roughly ten
  seconds) — shifts after that are not seen. Shifts flagged `hadRecentInput`
  are counted, because the tool never sends input; under mobile emulation
  Chromium flags the first half-second after every navigation anyway.
- Webfont verdicts rest on a **painted witness**: the element's own text, on
  one line, at least six characters, measured against the same characters in
  the fallback stack. A stack whose only text is shorter ("15", an icon
  glyph) gets no verdict. FontFace status is never used as evidence of
  failure — WebKit reports `error` on faces it is plainly drawing.
- A page declared with `font-display: optional` legitimately renders in the
  fallback on some loads (about one in four to eight on the site this was
  measured on). The finding says so and is true for that load; it is not a
  broken file, and it will not appear on every run.
- A bot wall or error page is recognised by known markers, challenge titles,
  short "you have been blocked" bodies, or a 403/429/503 main document, and
  reported as `blocked`. A wall that looks like an ordinary page would pass
  through as the site.

## Captures and timing

- Lazy content is triggered by scrolling the whole page (up to
  `--max-scroll-viewports`, default 40) and waiting up to six seconds for
  every `<img>` to finish. CSS background images, iframes and embeds are not
  awaited; a page that loads those late may differ between two runs, and the
  diff will name the container.
- A page that never goes network-idle (analytics heartbeats, polling) is
  captured after a 1.5 s settle at the 30 s mark, and the note says so.
  Such pages can differ between runs for reasons outside the tool.
- Every awaited stage in the page (font loading, the scroll pass, image
  settling) has a deadline, because `page.evaluate` has none of its own and
  a font request that never completes once held a capture for 76 minutes. A
  deadline that fires is recorded in the notes and can leave a verdict
  incomplete.
- Full-page captures are clipped at the viewport width (so overflow shows as
  overflow, not as a wider image) and capped at 30 000 CSS px tall. Some
  engines repeat a fixed header down a full-page capture; the note says so.

## Baseline diffing

- Pixels within 25/255 per channel are "the same", and a 3×3 opening drops
  one-pixel speckle from anti-aliasing. A hairline that moves by a pixel does
  not register; a colour change on a one-pixel border does not either.
- Two runs of a stable page differ by 0.0 % in practice; a page with lazy
  embeds, carousels driven by JavaScript timers, clocks or ad slots will not.
  Mask those with `--ignore-regions` — the report names the containers where
  the change sits and prints the selector to use.
- A page that grew or shrank has the new or missing strip counted as changed,
  and the report says by how many CSS px.
- The regression threshold (`--diff-threshold`, default 0.1 %) is a share of
  all pixels in a full-page capture; on a very tall page a real but small
  change can sit under it. Read the diff image, not just the number.

## As a service

- Runs live on the service's disk under `RUNS_DIR`. Without a persistent
  volume mounted there, a redeploy discards every gallery; the Dashboard keeps
  each run's report and a JPEG of each fold, so verdicts survive, but the
  full-page images and the ability to diff against that run do not.
- With the volume, the service keeps the newest `RETAIN_PER_SITE` (default 2)
  runs of each URL and deletes the rest. Only the newest run of a URL keeps
  its PNG originals and gallery; the older kept run has its report and a
  900 px JPEG of every capture. So a baseline diff is only possible against
  the newest run of a page, an older run's gallery link answers "no longer
  kept", and what the Dashboard shows for an older run's full page is the
  JPEG, not the pixel-exact capture.
- One run at a time (`MAX_RUNNING`), because three browser engines on a
  small instance are enough; a second request gets `429 run_capacity` and the
  caller retries later rather than queueing.

## Not built

- `--record-motion` (video + trace) from the CLI specification is not
  implemented.
- The Dockerfile exists and is exercised by CI conventions, but has not been
  built on the development machine (no Docker there).
