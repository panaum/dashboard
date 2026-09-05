#!/usr/bin/env python3
"""devicepreview — how a URL renders across a fixed matrix of device profiles.

Step 1 of the build: the device matrix, the capture interface, and the `local`
backend, producing screenshots. No audit probe yet (step 3), no gallery (step 5).

One interface, swappable backends:

    capture(url, profile, options) -> CaptureResult

The caller never knows which backend served a capture; the result shape is
identical across all of them. Only `local` exists in this step; `macos` and
`browserstack` are step 7 and say so if selected.

Conventions follow services/pagecheck: Playwright's sync API, no dependencies
beyond Playwright and the standard library (Pillow is used for thumbnails ONLY
if it is already importable, and its absence is recorded, not fatal), and every
non-obvious decision carries the reason it was made.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from playwright.sync_api import (
    Browser, BrowserContext, Error as PWError, Playwright, TimeoutError as PWTimeout,
    sync_playwright,
)

HERE = Path(__file__).parent
TOOL_VERSION = "0.1.0"
SCHEMA_VERSION = 1
ENGINES = ("chromium", "firefox", "webkit")

# ── device profiles ─────────────────────────────────────────────────────────


@dataclass
class Profile:
    id: str
    label: str
    engine: str
    platform: str
    tier: str
    viewport: dict[str, int]
    device_scale_factor: float
    is_mobile: bool
    has_touch: bool
    user_agent: str | None
    verified: bool
    playwright_device: str | None = None

    def context_options(self, landscape: bool) -> dict[str, Any]:
        w, h = self.viewport["width"], self.viewport["height"]
        if landscape:
            w, h = h, w
        opts: dict[str, Any] = {
            "viewport": {"width": w, "height": h},
            "device_scale_factor": self.device_scale_factor,
            "is_mobile": self.is_mobile,
            "has_touch": self.has_touch,
        }
        if self.user_agent:
            opts["user_agent"] = self.user_agent
        return opts


def load_devices(pw: Playwright | None, path: Path = HERE / "devices.json") -> list[Profile]:
    """Read the matrix. Where a profile names a Playwright descriptor, spread it
    first and let the explicit fields override — so user-agent strings track
    Playwright's updates instead of rotting in our data file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[Profile] = []
    for p in data["profiles"]:
        base: dict[str, Any] = {}
        name = p.get("playwrightDevice")
        if name and pw is not None:
            desc = pw.devices.get(name)
            if desc is None:
                print(f"  warning: {p['id']} names Playwright device {name!r}, which this "
                      "Playwright does not ship — using explicit fields only", file=sys.stderr)
            else:
                base = dict(desc)
        out.append(Profile(
            id=p["id"], label=p["label"], engine=p["engine"], platform=p["platform"],
            tier=p["tier"], viewport=p["viewport"],
            device_scale_factor=p.get("deviceScaleFactor", base.get("device_scale_factor", 1)),
            is_mobile=p.get("isMobile", base.get("is_mobile", False)),
            has_touch=p.get("hasTouch", base.get("has_touch", False)),
            # null in the data file means "engine default" for desktops, or
            # "whatever the spread descriptor says" for mobiles.
            user_agent=p["userAgent"] if p.get("userAgent") else base.get("user_agent"),
            verified=bool(p.get("verified", False)),
            playwright_device=name,
        ))
    return out


def select_profiles(all_profiles: list[Profile], devices: str, tier: str,
                    include_edge: bool) -> list[Profile]:
    if devices and devices != "all":
        wanted = {d.strip() for d in devices.split(",") if d.strip()}
        unknown = wanted - {p.id for p in all_profiles}
        if unknown:
            raise SystemExit(f"unknown device id(s): {', '.join(sorted(unknown))}. "
                             f"Known: {', '.join(p.id for p in all_profiles)}")
        return [p for p in all_profiles if p.id in wanted]
    chosen = [p for p in all_profiles if tier == "all" or p.tier == "primary"]
    if include_edge:
        chosen += [p for p in all_profiles if p.tier == "edge" and p not in chosen]
    return chosen


# ── capture contract ────────────────────────────────────────────────────────


@dataclass
class CaptureOptions:
    out_dir: Path
    landscape: bool = False
    color_scheme: str = "light"          # light | dark
    timeout_s: float = 30.0
    settle_ms: int = 1500                 # used when networkidle never arrives
    max_scroll_viewports: int = 5         # lazy-load trigger cap; infinite pages stop here
    locale: str = "en-AU"
    timezone_id: str = "Australia/Sydney"
    thumb_width: int = 280


@dataclass
class CaptureResult:
    """Identical across backends — a caller must never need to know which one ran."""
    profile_id: str
    label: str
    engine: str
    platform: str
    tier: str
    verified: bool
    backend: str
    url: str
    final_url: str | None = None
    status: str = "ok"                    # ok | failed
    error: str | None = None
    viewport: dict[str, int] = field(default_factory=dict)
    device_scale_factor: float = 1.0
    landscape: bool = False
    color_scheme: str = "light"
    images: dict[str, str] = field(default_factory=dict)   # fold | full | thumb -> path
    timings_ms: dict[str, int] = field(default_factory=dict)
    fonts: dict[str, Any] = field(default_factory=dict)
    fixed_chrome: list[dict[str, Any]] = field(default_factory=list)
    page: dict[str, Any] = field(default_factory=dict)      # scrollWidth, scrollHeight, title
    notes: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)   # step 3


# ── page-side JS ────────────────────────────────────────────────────────────

# Freezing motion is what makes two captures of the same page comparable. The
# caret is hidden because a blinking cursor in a focused field is a diff too.
FREEZE_CSS = """
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
"""

FONTS_JS = """async () => {
  try { await document.fonts.ready; } catch (e) {}
  const faces = [];
  try { for (const f of document.fonts) faces.push({ family: f.family, status: f.status, weight: f.weight, style: f.style }); }
  catch (e) {}
  // A page asking for Apple's system face will be substituted on Linux. That is
  // a fidelity note the reader needs, not a defect in the page.
  let apple = false;
  try {
    for (const el of document.querySelectorAll('body, h1, h2, h3, p, a, button')) {
      const ff = getComputedStyle(el).fontFamily.toLowerCase();
      if (/-apple-system|sf pro|san francisco|blinkmacsystemfont/.test(ff)) { apple = true; break; }
    }
  } catch (e) {}
  return { faces, requestsAppleSystemFont: apple };
}"""

LAZY_SCROLL_JS = """async (maxViewports) => {
  const step = Math.max(200, Math.floor(window.innerHeight * 0.9));
  const limit = window.innerHeight * maxViewports;
  let y = 0;
  while (y < document.documentElement.scrollHeight && y < limit) {
    y += step;
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 200));
  return { scrolledTo: Math.min(y, document.documentElement.scrollHeight),
           capped: y >= limit && y < document.documentElement.scrollHeight };
}"""

# Fixed and sticky elements that sit across the top of the viewport. Some
# engines repeat these down a full-page capture; recording their height lets
# the report say so instead of shipping a silently wrong image.
FIXED_CHROME_JS = """() => {
  const out = [];
  const vh = window.innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 10) continue;
    const atTop = r.top <= 2 && r.bottom > 0;
    const atBottom = r.bottom >= vh - 2 && r.top < vh;
    if (!atTop && !atBottom) continue;
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    out.push({ selector: (el.tagName.toLowerCase() + id + cls).slice(0, 80),
               position: s.position, edge: atTop ? 'top' : 'bottom',
               height: Math.round(r.height) });
  }
  return out;
}"""

PAGE_JS = """() => ({
  title: (document.title || '').slice(0, 200),
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  innerWidth: window.innerWidth, innerHeight: window.innerHeight,
})"""


# ── backends ────────────────────────────────────────────────────────────────


class Backend:
    name = "abstract"

    def capture(self, url: str, profile: Profile, options: CaptureOptions) -> CaptureResult:
        raise NotImplementedError

    def close(self) -> None:
        pass


class LocalBackend(Backend):
    """Playwright's bundled engines, headless, in this process.

    One browser per engine, reused across profiles; a fresh BrowserContext per
    profile. Launching a browser per device is the main performance mistake
    available here — a launch is seconds, a context is milliseconds."""
    name = "local"

    def __init__(self, pw: Playwright):
        self._pw = pw
        self._browsers: dict[str, Browser] = {}

    def _browser(self, engine: str) -> Browser:
        if engine not in self._browsers:
            launcher = getattr(self._pw, engine)
            self._browsers[engine] = launcher.launch()
        return self._browsers[engine]

    @contextmanager
    def _context(self, profile: Profile, options: CaptureOptions) -> Iterator[BrowserContext]:
        ctx = self._browser(profile.engine).new_context(
            **profile.context_options(options.landscape),
            locale=options.locale,
            timezone_id=options.timezone_id,
            color_scheme=options.color_scheme,
            reduced_motion="reduce",
        )
        ctx.set_default_timeout(options.timeout_s * 1000)
        try:
            yield ctx
        finally:
            # Never leak a context on an exception: each one is a whole
            # browser tab's worth of memory, and a 15-device run would bleed.
            try:
                ctx.close()
            except PWError:
                pass

    def capture(self, url: str, profile: Profile, options: CaptureOptions) -> CaptureResult:
        w, h = profile.viewport["width"], profile.viewport["height"]
        if options.landscape:
            w, h = h, w
        res = CaptureResult(
            profile_id=profile.id, label=profile.label, engine=profile.engine,
            platform=profile.platform, tier=profile.tier, verified=profile.verified,
            backend=self.name, url=url, viewport={"width": w, "height": h},
            device_scale_factor=profile.device_scale_factor,
            landscape=options.landscape, color_scheme=options.color_scheme,
        )
        t_start = time.time()
        font_requests: list[dict[str, Any]] = []

        try:
            with self._context(profile, options) as ctx:
                page = ctx.new_page()
                # Font files that fail are invisible in a screenshot when the
                # fallback looks plausible. The network is the only honest record.
                page.on("response", lambda r: font_requests.append(
                    {"url": r.url[:200], "status": r.status})
                    if r.request.resource_type == "font" else None)
                page.on("requestfailed", lambda rq: font_requests.append(
                    {"url": rq.url[:200], "status": None, "failure": (rq.failure or "")[:80]})
                    if rq.resource_type == "font" else None)

                t0 = time.time()
                page.goto(url, wait_until="domcontentloaded", timeout=options.timeout_s * 1000)
                try:
                    page.wait_for_load_state("networkidle", timeout=options.timeout_s * 1000)
                except PWTimeout:
                    # A page that polls or streams never goes idle. Degrade to a
                    # fixed settle rather than failing a capture that is fine.
                    page.wait_for_timeout(options.settle_ms)
                    res.notes.append(f"networkidle not reached in {options.timeout_s:.0f}s; "
                                     f"settled {options.settle_ms}ms instead")
                res.timings_ms["navigate"] = int((time.time() - t0) * 1000)
                res.final_url = page.url

                fonts = page.evaluate(FONTS_JS) or {}
                res.fonts = {
                    "faces": fonts.get("faces", []),
                    "requests": font_requests,
                    "failed_requests": [r for r in font_requests
                                        if r.get("status") is None or r["status"] >= 400],
                }
                if fonts.get("requestsAppleSystemFont"):
                    res.notes.append("page requests Apple system font (-apple-system / SF Pro); "
                                     "substituted on this backend, typography is not authentic")

                page.add_style_tag(content=FREEZE_CSS)

                t1 = time.time()
                scrolled = page.evaluate(LAZY_SCROLL_JS, options.max_scroll_viewports) or {}
                if scrolled.get("capped"):
                    res.notes.append(f"lazy-load scroll capped at {options.max_scroll_viewports} "
                                     "viewport heights — page may continue (infinite scroll?)")
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except PWTimeout:
                    pass
                res.timings_ms["lazy_scroll"] = int((time.time() - t1) * 1000)

                res.fixed_chrome = page.evaluate(FIXED_CHROME_JS) or []
                res.page = page.evaluate(PAGE_JS) or {}

                t2 = time.time()
                out = options.out_dir / profile.id
                out.mkdir(parents=True, exist_ok=True)
                suffix = ("-landscape" if options.landscape else "") + (
                    "-dark" if options.color_scheme == "dark" else "")
                fold = out / f"fold{suffix}.png"
                full = out / f"full{suffix}.png"
                page.screenshot(path=str(fold))
                # Full height at the VIEWPORT width. A plain full_page capture
                # widens to the document's scrollWidth, so an overflowing page
                # produces an image wider than any real screen — showing content
                # the visitor cannot reach and hiding the overflow itself. That
                # bit the sibling pagecheck tool; recorded here so it does not
                # need re-learning.
                sh = int(res.page.get("scrollHeight") or 0)
                if sh > 0:
                    page.screenshot(path=str(full), full_page=True,
                                    clip={"x": 0, "y": 0, "width": w, "height": min(sh, 30000)})
                else:
                    page.screenshot(path=str(full), full_page=True)
                res.images["fold"] = str(fold)
                res.images["full"] = str(full)
                if int(res.page.get("scrollWidth") or 0) > w + 1:
                    res.notes.append(f"document is {res.page['scrollWidth']}px wide in a {w}px "
                                     "viewport — the page scrolls sideways")
                if any(c["edge"] == "top" for c in res.fixed_chrome):
                    res.notes.append("fixed/sticky header present — some engines repeat it down "
                                     "a full-page capture; check the full image before trusting it")

                thumb = _thumbnail(fold, out / f"thumb{suffix}.png", options.thumb_width)
                if thumb:
                    res.images["thumb"] = str(thumb)
                else:
                    res.notes.append("no thumbnail: Pillow not importable; gallery will scale "
                                     "the fold capture instead")
                res.timings_ms["screenshots"] = int((time.time() - t2) * 1000)
        except PWTimeout as exc:
            res.status, res.error = "failed", f"timeout: {str(exc)[:200]}"
        except PWError as exc:
            res.status, res.error = "failed", f"{type(exc).__name__}: {str(exc)[:200]}"

        res.timings_ms["total"] = int((time.time() - t_start) * 1000)
        return res

    def close(self) -> None:
        for b in self._browsers.values():
            try:
                b.close()
            except PWError:
                pass
        self._browsers.clear()


def _thumbnail(src: Path, dst: Path, width: int) -> Path | None:
    """Downscale the fold capture for the gallery grid. Pillow is optional: it is
    used when present and its absence is a recorded note, never a hard failure."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    try:
        with Image.open(src) as im:
            ratio = width / im.width
            im.resize((width, max(1, int(im.height * ratio)))).save(dst)
        return dst
    except Exception:  # noqa: BLE001 — a thumbnail must never fail a capture
        return None


class NotBuiltYetBackend(Backend):
    def __init__(self, name: str, step: int, how: str):
        self.name, self._step, self._how = name, step, how

    def capture(self, url, profile, options):
        raise SystemExit(f"backend {self.name!r} is build step {self._step} and is not "
                         f"implemented yet. {self._how}")


def make_backend(name: str, pw: Playwright) -> Backend:
    if name == "local":
        return LocalBackend(pw)
    if name == "macos":
        return NotBuiltYetBackend("macos", 7, "It will run this same code on a macOS host so "
                                 "WebKit uses Apple's real font stack.")
    if name == "browserstack":
        if not os.environ.get("BROWSERSTACK_KEY"):
            raise SystemExit("backend 'browserstack' needs BROWSERSTACK_KEY (and "
                             "BROWSERSTACK_USER) set in the environment. It is also build "
                             "step 7 and not implemented yet.")
        return NotBuiltYetBackend("browserstack", 7, "It will use the Screenshots REST API.")
    raise SystemExit(f"unknown backend {name!r}; choose local, macos or browserstack")


# ── font self-check ─────────────────────────────────────────────────────────

# Fonts are the single biggest source of garbage screenshots on headless Linux.
# Ten "i"s rendering as wide as ten "W"s means every proportional face fell back
# to a monospace — and a hundred captures would all be wrong the same way. This
# is checked before a run and fails loudly, rather than shipping them silently.
# Measured on inline <span>s, which shrink-wrap their text. The first version
# measured block <p>s and got the container width every time — 1248px for ten
# "i"s, ten "W"s, CJK and emoji alike — and so failed a machine with perfectly
# good fonts, then refused to run on the strength of its own bug.
SELF_CHECK_HTML = """<!doctype html><meta charset="utf-8">
<style>body{font:16px sans-serif;margin:16px} .serif{font-family:serif} p{margin:4px 0}</style>
<p><span id="narrow">iiiiiiiiii</span></p><p><span id="wide">WWWWWWWWWW</span></p>
<p><span id="serif" class="serif">The quick brown fox jumps over the lazy dog</span></p>
<p><span id="cjk">日本語のテキスト</span></p><p><span id="emoji">😀🎉</span></p>"""

SELF_CHECK_JS = """() => {
  const w = id => document.getElementById(id).getBoundingClientRect().width;
  return { narrow: w('narrow'), wide: w('wide'), serif: w('serif'),
           cjk: w('cjk'), emoji: w('emoji') };
}"""


def self_check(pw: Playwright, engines: tuple[str, ...], say) -> list[str]:
    """Returns a list of problems; empty means fonts look sane. The monospace
    test is the reliable one. Missing CJK or emoji glyphs still render as boxes
    with width, so those are reported as measurements, not verdicts."""
    problems: list[str] = []
    for engine in engines:
        try:
            b = getattr(pw, engine).launch()
        except PWError as exc:
            problems.append(f"{engine}: cannot launch — {str(exc)[:120]}")
            continue
        try:
            pg = b.new_page()
            pg.set_content(SELF_CHECK_HTML)
            m = pg.evaluate(SELF_CHECK_JS)
            say(f"  self-check {engine:8} i×10={m['narrow']:.0f}px  W×10={m['wide']:.0f}px  "
                f"cjk={m['cjk']:.0f}px  emoji={m['emoji']:.0f}px")
            if m["narrow"] <= 0 or m["wide"] <= 0:
                problems.append(f"{engine}: text did not render at all")
            elif abs(m["narrow"] - m["wide"]) < 2:
                problems.append(f"{engine}: proportional text renders monospace "
                                "(i×10 == W×10) — font fallback is broken")
        finally:
            b.close()
    return problems


# ── running the matrix ──────────────────────────────────────────────────────


def _capture_with_retry(backend: Backend, url: str, profile: Profile,
                        options: CaptureOptions, say) -> CaptureResult:
    """One retry, with double the timeout. A single flaky navigation must not
    fail a fifteen-device run; a page that fails twice has genuinely failed."""
    first = backend.capture(url, profile, options)
    if first.status == "ok":
        return first
    say(f"  {profile.label}: retrying with {options.timeout_s * 2:.0f}s timeout — {first.error}")
    second = backend.capture(url, profile, replace(options, timeout_s=options.timeout_s * 2))
    if second.status == "ok":
        second.notes.insert(0, f"first attempt failed ({first.error}); succeeded on retry")
    else:
        second.notes.insert(0, f"failed twice; first attempt: {first.error}")
    return second


def run_engine(engine: str, profiles: list[Profile], url: str, schemes: list[str],
               base_opts: CaptureOptions, backend_name: str, say) -> list[CaptureResult]:
    """Everything one engine has to do, on one thread, with one browser.

    Playwright's sync API is bound to the thread that created it, so this is
    the unit of parallelism: engines run side by side, and captures within an
    engine run in sequence against that engine's single browser. Never more
    than one browser per engine — a launch is seconds, a context is
    milliseconds, and browsers are memory-hungry."""
    results: list[CaptureResult] = []
    with sync_playwright() as pw:
        backend = make_backend(backend_name, pw)
        try:
            for scheme in schemes:
                opts = replace(base_opts, color_scheme=scheme)
                for p in profiles:
                    r = _capture_with_retry(backend, url, p, opts, say)
                    say(f"  {p.label:28} {engine:8} {scheme:5} {r.status:6} "
                        f"{r.timings_ms.get('total', 0):>6}ms" + (f"  — {r.error}" if r.error else ""))
                    results.append(r)
        finally:
            backend.close()
    return results


def run_matrix(url: str, chosen: list[Profile], schemes: list[str], base_opts: CaptureOptions,
               backend_name: str, concurrency: int, say) -> tuple[list[CaptureResult], dict]:
    by_engine: dict[str, list[Profile]] = {}
    for p in chosen:
        by_engine.setdefault(p.engine, []).append(p)
    workers = max(1, min(concurrency, len(by_engine)))
    t0 = time.time()
    results: list[CaptureResult] = []
    engine_ms: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(run_engine, e, ps, url, schemes, base_opts, backend_name, say): e
                   for e, ps in by_engine.items()}
        for fut in as_completed(futures):
            engine = futures[fut]
            rs = fut.result()
            engine_ms[engine] = sum(r.timings_ms.get("total", 0) for r in rs)
            results.extend(rs)
    # Report in matrix order regardless of which engine finished first.
    order = {p.id: i for i, p in enumerate(chosen)}
    results.sort(key=lambda r: (order.get(r.profile_id, 999), r.color_scheme))
    return results, {"wallMs": int((time.time() - t0) * 1000), "workers": workers,
                     "perEngineMs": engine_ms}


# ── CLI ─────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(prog="devicepreview",
                                 description="How does this URL render across real device profiles?")
    ap.add_argument("url", nargs="?")
    ap.add_argument("--devices", default="", help="comma list of ids, or 'all'")
    ap.add_argument("--tier", choices=("primary", "all"), default="primary")
    ap.add_argument("--include-edge", action="store_true")
    ap.add_argument("--landscape", action="store_true")
    ap.add_argument("--color-scheme", choices=("light", "dark", "both"), default="light")
    ap.add_argument("--backend", choices=("local", "macos", "browserstack"), default="local")
    ap.add_argument("--concurrency", type=int, default=min(os.cpu_count() or 1, 4),
                    help="parallel engines; default min(cpu_count, 4)")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds")
    ap.add_argument("--out", help="default: ./runs/<timestamp>")
    ap.add_argument("--json", action="store_true", help="print report.json path only")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="render a font test page in every engine and exit")
    ap.add_argument("--no-self-check", action="store_true",
                    help="skip the pre-run font check (it costs about a second)")
    args = ap.parse_args()

    lock = threading.Lock()
    def say(*a, **k):
        if args.json:
            return
        with lock:
            print(*a, file=sys.stderr, **k)

    with sync_playwright() as pw:
        if args.self_check:
            problems = self_check(pw, ENGINES, say)
            for pr in problems:
                print(f"  FAIL {pr}", file=sys.stderr)
            print("  fonts look sane in all engines" if not problems else
                  f"  {len(problems)} problem(s)", file=sys.stderr)
            return 2 if problems else 0
        profiles = load_devices(pw)
        if args.list_devices:
            for p in profiles:
                v = "" if p.verified else "  (unverified)"
                print(f"  {p.id:22} {p.label:28} {p.engine:9} {p.viewport['width']}x{p.viewport['height']} "
                      f"@{p.device_scale_factor:g}  {p.tier}{v}")
            return 0
        if not args.url:
            ap.error("a url is required")
        # A quick chromium-only check before spending minutes on captures. The
        # full three-engine check is --self-check.
        problems = [] if args.no_self_check else self_check(pw, ("chromium",), say)
        if problems:
            for pr in problems:
                print(f"  FAIL {pr}", file=sys.stderr)
            print("  refusing to run: screenshots would be wrong. Install the fonts in the "
                  "Dockerfile, or pass --no-self-check to override.", file=sys.stderr)
            return 2

    url = args.url if "://" in args.url else f"https://{args.url}"
    out_dir = Path(args.out) if args.out else Path("runs") / datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    chosen = select_profiles(profiles, args.devices, args.tier, args.include_edge)
    schemes = ["light", "dark"] if args.color_scheme == "both" else [args.color_scheme]
    base_opts = CaptureOptions(out_dir=out_dir, landscape=args.landscape, timeout_s=args.timeout)

    started = datetime.now(timezone.utc)
    say(f"  {len(chosen)} device(s) × {len(schemes)} scheme(s), "
        f"{len({p.engine for p in chosen})} engine(s) in parallel")
    results, timing = run_matrix(url, chosen, schemes, base_opts, args.backend,
                                 args.concurrency, say)

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "tool": {"name": "devicepreview", "version": TOOL_VERSION, "step": 2},
        "url": url,
        "startedAt": started.isoformat(timespec="seconds"),
        "finishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "backend": args.backend,
        "options": {"landscape": args.landscape, "colorScheme": args.color_scheme,
                    "timeoutSeconds": args.timeout, "concurrency": args.concurrency},
        "timing": timing,
        "devices": [asdict(r) for r in results],
        "unverifiedProfiles": sorted({r.profile_id for r in results if not r.verified}),
        "fidelityNote": ("The local backend uses real browser engines, not real devices. "
                         "Layout, breakpoints and overflow are accurate; font rasterisation, "
                         "scroll physics and OS animation timing are not. See LIMITATIONS.md."),
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    failed = [r for r in results if r.status != "ok"]
    if args.json:
        print(out_dir / "report.json")
    else:
        say(f"\n  {len(results)} capture(s), {len(failed)} failed, "
            f"{timing['wallMs'] / 1000:.1f}s wall → {out_dir}/report.json")
    # 0 clean, 1 error-severity finding (none until step 3), 2 tool failure.
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
