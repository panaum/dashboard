#!/usr/bin/env python3
"""devicepreview — how a URL renders across a fixed matrix of device profiles.

Build steps 1–4: the device matrix, the capture interface, the `local` backend
with engine parallelism, and the full twelve-rule audit probe. No gallery yet
(step 5), no baseline diffing (step 6).

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
    rules: dict[str, bool] = field(default_factory=lambda: dict(DEFAULT_RULES))


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
  // Force every declared face to settle. Font loading is lazy — a face is only
  // fetched when glyphs using it paint — and WebKit under some origins never
  // fetches at all, leaving status "unloaded" with no network event to record.
  // load() rejects on failure, so each is caught; afterwards status is
  // loaded, error, or still unloaded (blocked before the network).
  const settle = async () => { try { await Promise.all([...document.fonts].map(f => f.status === 'unloaded' ? f.load().then(() => 1, () => 0) : 1)); } catch (e) {} };
  await settle();
  // A face can read "error" while the browser's own load of the same CSS
  // face is still in flight — on WebKit this flipped between identical runs
  // (error/error, loaded/loaded, loaded/error). Wait, ask once more, and only
  // then believe an error. A finding that changes between runs is not a finding.
  if ([...document.fonts].some(f => f.status === 'error')) {
    await new Promise(r => setTimeout(r, 600));
    try { await Promise.all([...document.fonts].map(f => f.status === 'error' ? f.load().then(() => 1, () => 0) : 1)); } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  // Judge what the visitor SEES, stack by stack. For every distinct
  // font-family/weight/style that some element's OWN text is set in, drop two
  // hidden probes inside one such element: one inheriting the stack as it is,
  // one with the page's @font-face families struck out of it. If both measure
  // the same, the webfonts contributed nothing and that text is in a fallback.
  // Neither FontFace status nor document.fonts.check() is trusted as evidence
  // of failure: WebKit reported both declarations of Poppins-Regular in
  // "error" on a run whose screenshot showed Poppins in every paragraph.
  // Containers are skipped — a div whose innerText comes from children with
  // their own font-family draws no glyphs — which is how 52 wrappers once made
  // a family look "used" that no text ever asked for.
  const declared = new Set();
  try { for (const f of document.fonts) declared.add(String(f.family).replace(/^["']|["']$/g, '').toLowerCase()); } catch (e) {}
  const bare = (s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase();
  const splitStack = (ff) => ff.split(',').map(x => x.trim()).filter(Boolean);
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont)$/;
  const SKIP = /^(script|style|noscript|template|svg|input|textarea|select|option|img|video|canvas|iframe)$/i;
  const own = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const stacks = new Map();
  try {
    for (const el of document.querySelectorAll('body *')) {
      if (SKIP.test(el.tagName) || !(el instanceof HTMLElement) || !own(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fams = splitStack(cs.fontFamily || '');
      if (!fams.some(f => declared.has(bare(f)))) continue;   // a system-font stack has nothing to lose
      const key = cs.fontFamily + '|' + cs.fontWeight + '|' + cs.fontStyle;
      const st = stacks.get(key) || { stack: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle, elements: 0, el, families: fams };
      st.elements++; stacks.set(key, st);
    }
  } catch (e) {}
  const PROBE = 'mmmmmmmmmmlliIWw0';
  const measure = (host, ff) => {
    const sp = document.createElement('span');
    sp.textContent = PROBE;
    sp.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;'
      + 'font-size:inherit;font-weight:inherit;font-style:inherit;letter-spacing:0;word-spacing:0;text-transform:none;font-family:' + ff;
    host.appendChild(sp);
    const w = sp.getBoundingClientRect().width;
    sp.remove();
    return w;
  };
  const stackOut = [];
  for (const st of stacks.values()) {
    const decl = st.families.filter(f => declared.has(bare(f)));
    const without = st.families.filter(f => !declared.has(bare(f)));
    // A stack with no generic tail falls to the UA default face; compare
    // against serif, which is that default in every engine we run.
    if (!without.some(f => GENERIC.test(bare(f)))) without.push('serif');
    let renders = null;
    try {
      const w = measure(st.el, 'inherit'), wo = measure(st.el, without.join(', '));
      renders = (w > 0 && wo > 0) ? Math.abs(w - wo) >= 0.5 : null;
    } catch (e) {}
    const status = {};
    try { for (const f of document.fonts) { const k = bare(String(f.family)); if (decl.some(d => bare(d) === k)) (status[k] = status[k] || []).push(f.status); } } catch (e) {}
    const el = st.el;
    const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\\s+/)[0] : '';
    stackOut.push({ stack: st.stack, weight: st.weight, style: st.style, elements: st.elements,
      sample: (el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls)).slice(0, 60),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      declared: decl.map(d => d.trim().replace(/^["']|["']$/g, '')), status, renders });
  }
  // Per-face view for the report: a family is "used" when some text's stack
  // names it, and "renders" when a stack that leads with it measured as drawn.
  const usedFams = new Set(), rendersFam = {};
  for (const so of stackOut) {
    for (const d of so.declared) usedFams.add(bare(d));
    const lead = bare(so.declared[0]);
    if (so.renders === true) rendersFam[lead] = true;
    else if (so.renders === false && rendersFam[lead] === undefined) rendersFam[lead] = false;
  }
  const faces = [];
  try { for (const f of document.fonts) {
    const key = bare(String(f.family));
    faces.push({ family: f.family, status: f.status, weight: f.weight, style: f.style,
      used: usedFams.has(key), renders: usedFams.has(key) ? (rendersFam[key] === undefined ? null : rendersFam[key]) : null }); } }
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
  return { faces, stacks: stackOut, requestsAppleSystemFont: apple };
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

# ── audit probe ─────────────────────────────────────────────────────────────
# Runs in the page after lazy loading, per device. Every finding carries a
# severity, a rule id, a plain message, a selector and a page-coordinate box so
# the gallery can draw it. Rules are individually switchable; different clients
# care about different things.
#
# Two lessons from calibrating the sibling tool on real client pages are baked
# in. Overflow reports the element where the excess is INTRODUCED — the one
# that is wider than its parent — not every descendant of it, or a single wide
# hero produces a hundred rows. And "wider than the viewport" is scoped to
# elements clipped by an ancestor, so the page does NOT scroll: that is the case
# a scroll-gated overflow check is blind to (a photo cut at the edge of a 1024px
# viewport passed as clean), and keeping the two disjoint means one fixture can
# trigger exactly one rule.

DEFAULT_RULES: dict[str, bool] = {
    "overflow": True, "element-wider": True, "tap-small": True, "tap-close": True,
    "clipped-text": True, "text-small": True, "fixed-chrome": True, "viewport-meta": True,
    "webfont": True, "offscreen": True, "image-size": True, "cls": True,
}

# Registered before any page script runs. Only Chromium implements the
# layout-shift entry type; elsewhere the observer throws, __dpCLS stays null,
# and the rule says "not measurable" rather than reporting a fake zero.
CLS_INIT_JS = """(() => {
  window.__dpCLS = null;
  // Ask, don't trust the throw. WebKit accepts an unknown entry type without
  // complaint, so a try/catch left __dpCLS at 0 on an engine that measured
  // nothing — a fake zero, the exact outcome this null is meant to prevent.
  try {
    const ok = typeof PerformanceObserver !== 'undefined'
      && Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes('layout-shift');
    if (ok) {
      window.__dpCLS = 0;
      // Count every entry, hadRecentInput included. This tool never taps,
      // clicks or types, so that flag can only come from Chromium itself: under
      // is_mobile emulation it marks the first ~500ms after EVERY navigation as
      // "recent input" (desktop and has_touch-only contexts do not). Honouring
      // it discarded every load-time shift on every phone and tablet profile —
      // the font swaps and unsized images the rule exists to catch.
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__dpCLS += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    }
  } catch (e) { window.__dpCLS = null; }
})();"""

AUDIT_JS = """(cfg) => {
  const rules = cfg.rules || {};
  const vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
  const doc = document.documentElement;
  const findings = [];

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0.5 || r.height <= 0.5) return false;
    // Off-canvas is not visible. An off-screen mobile menu (translated to
    // x = -972) passed every style check and contributed thirty tap-target
    // findings for links nobody could see, let alone tap.
    if (r.right <= 0 || r.left >= vw) return false;
    if (r.bottom + sy <= 0) return false;
    return true;
  };
  // Unique enough to draw an overlay and to find the element again by hand.
  const sel = (el) => {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    let nth = '';
    const p = el.parentElement;
    if (p) {
      const same = [...p.children].filter(c => c.tagName === el.tagName);
      if (same.length > 1) nth = ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return (el.tagName.toLowerCase() + cls + nth).slice(0, 90);
  };
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top + sy),
                        width: Math.round(r.width), height: Math.round(r.height) });
  const snippet = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50);
  // Content inside a container that clips or scrolls cannot move the document.
  const clippedBy = (el) => {
    let n = el.parentElement;
    while (n && n !== doc) {
      if (/hidden|clip|auto|scroll/.test(getComputedStyle(n).overflowX)) return n;
      n = n.parentElement;
    }
    return null;
  };
  const all = [...document.querySelectorAll('body *')];
  const docOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  // A carousel or marquee track is meant to be wider than the frame and to hold
  // items off screen: that is how it works, not a defect. On a real page an
  // animated benefits ticker produced two "clipped" warnings and six
  // "offscreen" notes for content that scrolls into view on its own.
  const SLIDER = '[class*="splide"],[class*="swiper"],[class*="slick"],[class*="carousel"],[class*="slider"],'
    + '[class*="glide"],[class*="flickity"],[class*="marquee"],[class*="ticker"],[class*="track"],[id*="track"],[class*="loop"]';
  const inSlider = (el) => !!el.closest(SLIDER);

  // Every helper a rule may call is declared HERE, above the first rule. These
  // three once lived below element-wider; const is hoisted only into a
  // temporal dead zone, so the first page with content past the edge threw a
  // ReferenceError, the whole probe died, and the capture came back with an
  // empty findings list that looked like a clean page.
  const isMobile = !!cfg.isMobile;
  const dpr = cfg.dpr || 1;
  const textRects = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, budget = 200;
    while ((n = w.nextNode()) && budget-- > 0) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
    }
    return out;
  };
  const ownText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    return false;
  };
  const rollup = (rule, sev, count, what) => findings.push({ severity: sev, rule,
    message: count + ' more ' + what + ' not listed', selector: 'body', box: { x: 0, y: 0, width: vw, height: vh } });

  // ── overflow: the page scrolls sideways ────────────────────────────────
  if (rules.overflow && docOverflow > 1) {
    findings.push({ severity: 'error', rule: 'overflow',
      message: 'The page scrolls sideways by ' + docOverflow + 'px (' + doc.scrollWidth + 'px wide in a ' + vw + 'px viewport)',
      selector: 'html', box: { x: 0, y: 0, width: doc.scrollWidth, height: vh } });
    let n = 0;
    for (const el of all) {
      if (!vis(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1) continue;
      if (clippedBy(el)) continue;                       // cannot be a cause
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > vw + 1) continue; // report the source, not its children
      findings.push({ severity: 'error', rule: 'overflow',
        message: sel(el) + ' extends ' + Math.round(r.right - vw) + 'px past the viewport',
        selector: sel(el), box: box(r), text: snippet(el) });
      if (++n >= 6) break;
    }
  }

  // ── element-wider: content clipped at the viewport edge (the page does not scroll) ──
  // Two shapes of the same visitor-facing symptom. An element WIDER than the
  // viewport, and an element of ordinary width POSITIONED past the edge — a
  // 291px photo sitting at x=768 in a 1024px viewport loses 35px, and is not
  // "wider than the viewport" by any reading. The width-only wording missed
  // the exact bug that motivated this rule. Only content counts: images and
  // text-bearing elements, never decorative bleed.
  if (rules['element-wider']) {
    let n = 0;
    for (const el of all) {
      if (!vis(el)) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      const wider = r.width > vw + 1;
      const pastR = Math.round(r.right - vw), pastL = Math.round(-r.left);
      const past = Math.max(pastR, pastL);
      if (!wider && past < 8) continue;
      if (r.right <= 0 || r.left >= vw) continue;         // wholly off screen: off-canvas by design
      if (inSlider(el)) continue;
      const isImg = el.tagName === 'IMG' || el.tagName === 'PICTURE';
      if (!wider && !isImg && !ownText(el)) continue;    // positioned decoration bleeding is a design choice
      const clip = clippedBy(el);
      if (!clip) continue;                                // unclipped → that is the overflow rule's job
      if (/auto|scroll/.test(getComputedStyle(clip).overflowX)) continue; // a scrollable strip is meant to extend
      const p = el.parentElement;
      if (p && p !== clip) {
        const pr = p.getBoundingClientRect();
        if (pr.width > vw + 1 || pr.right - vw >= 8 || -pr.left >= 8) continue; // outermost offender only
      }
      const frac = Math.round((past / Math.max(1, r.width)) * 100);
      if (!wider && frac >= 90) continue;                 // a sliver on screen is a carousel neighbour
      findings.push({ severity: 'warn', rule: 'element-wider',
        message: wider
          ? sel(el) + ' is ' + Math.round(r.width) + 'px wide in a ' + vw + 'px viewport; ' + past + 'px is clipped and cannot be seen'
          : sel(el) + ' extends ' + past + 'px past the ' + (pastR >= pastL ? 'right' : 'left') + ' edge (' + frac + '% of it is clipped and cannot be seen)',
        selector: sel(el), box: box(r), text: snippet(el) });
      if (++n >= 8) break;
    }
  }

  // ── tap targets (touch profiles only) ──────────────────────────────────
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role="button"], [onclick]';
  if (cfg.hasTouch && (rules['tap-small'] || rules['tap-close'])) {
    const inter = [...document.querySelectorAll(INTERACTIVE)].filter(vis).slice(0, 400);
    const rects = inter.map(el => el.getBoundingClientRect());

    // Two standards, two severities. Under 24px in either dimension fails
    // WCAG 2.5.8 (AA) and is a warning. Between 24 and 44 meets AA and misses
    // only the 44px AAA ideal (2.5.5): info. Without the split a 130×34 header
    // button and a 22px-tall footer link read as the same problem.
    const small = (r) => Math.min(r.width, r.height) < 44;
    const sevFor = (r) => Math.min(r.width, r.height) < 24 ? 'warn' : 'info';
    if (rules['tap-small']) {
      let n = 0, total = 0, unlistedWarn = 0, unlistedInfo = 0;
      for (let i = 0; i < inter.length; i++) {
        const el = inter[i], r = rects[i];
        if (!small(r)) continue;
        // An icon inside a big button is fine: the button is the target.
        const host = el.parentElement && el.parentElement.closest(INTERACTIVE);
        if (host && host !== el) {
          const hr = host.getBoundingClientRect();
          if (hr.width >= 44 && hr.height >= 44) continue;
        }
        total++;
        if (n >= 12) { if (sevFor(r) === 'warn') unlistedWarn++; else unlistedInfo++; continue; }
        {
          const sv = sevFor(r);
          findings.push({ severity: sv, rule: 'tap-small',
            message: sel(el) + ' is ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px — '
              + (sv === 'warn' ? 'under the 24px WCAG AA minimum' : 'meets 24px AA but under the 44px AAA target'),
            selector: sel(el), box: box(r), text: snippet(el) });
          n++;
        }
      }
      // The rollup takes the severity of what it hides and says how many of
      // each, so an unlisted tail of AAA-only misses cannot inflate the
      // warning count.
      if (unlistedWarn + unlistedInfo > 0) findings.push({
        severity: unlistedWarn ? 'warn' : 'info', rule: 'tap-small',
        message: (unlistedWarn + unlistedInfo) + ' more small tap target(s) not listed'
          + (unlistedWarn ? ' — ' + unlistedWarn + ' under the 24px AA minimum' : '')
          + (unlistedInfo ? (unlistedWarn ? ', ' : ' — ') + unlistedInfo + ' between 24 and 44px' : ''),
        selector: 'body', box: { x: 0, y: 0, width: vw, height: vh } });
    }

    if (rules['tap-close']) {
      let n = 0;
      const seen = new Set();
      outer:
      for (let i = 0; i < inter.length; i++) {
        for (let j = i + 1; j < inter.length; j++) {
          const a = inter[i], b = inter[j];
          if (a.contains(b) || b.contains(a)) continue;
          const ra = rects[i], rb = rects[j];
          // Spacing matters when precision is required. Two full-width 52px
          // accordion rows touching is ordinary list UI, not a defect; a
          // pair only counts when at least one target is under 44px.
          if (!small(ra) && !small(rb)) continue;
          const dx = Math.max(0, Math.max(ra.left, rb.left) - Math.min(ra.right, rb.right));
          const dy = Math.max(0, Math.max(ra.top, rb.top) - Math.min(ra.bottom, rb.bottom));
          if (dx >= 8 || dy >= 8) continue;
          const key = sel(a) + '|' + sel(b);
          if (seen.has(key)) continue;
          seen.add(key);
          const smaller = Math.min(ra.width, ra.height) <= Math.min(rb.width, rb.height) ? ra : rb;
          // One decimal: a 7.6px gap rounded to "8px apart; need 8px" reads as a
          // false alarm to anyone checking the arithmetic.
          const gap = Math.max(dx, dy);
          findings.push({ severity: sevFor(smaller), rule: 'tap-close',
            message: sel(a) + ' and ' + sel(b) + ' are ' + (gap < 1 ? 'touching' : gap.toFixed(1) + 'px apart') + '; small touch targets need 8px between them',
            selector: sel(a), box: box(ra), related: sel(b), relatedBox: box(rb),
            text: snippet(a) });
          if (++n >= 8) break outer;
        }
      }
    }
  }


  // ── clipped-text: text cut off by overflow:hidden ──────────────────────
  // Ellipsis and line-clamp are deliberate. A box under 8px has nothing
  // visible to clip (collapsed accordion, screen-reader-only link). And the
  // GLYPHS must leave the box: a pulsing button reported 236px of hidden
  // overflow mid-animation while its label sat perfectly inside.
  if (rules['clipped-text']) {
    let n = 0, extra = 0;
    for (const el of all) {
      if (!vis(el) || !ownText(el)) continue;
      const s = getComputedStyle(el);
      const hidX = /hidden|clip/.test(s.overflowX), hidY = /hidden|clip/.test(s.overflowY);
      if (!hidX && !hidY) continue;
      if (s.textOverflow === 'ellipsis') continue;
      if (s.webkitLineClamp && s.webkitLineClamp !== 'none') continue;
      if (el.clientWidth < 8 || el.clientHeight < 8) continue;
      if (inSlider(el)) continue;
      if (el.closest('[aria-expanded="false"], [aria-hidden="true"], [hidden]')) continue;
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      if (!((hidX && dx >= 4) || (hidY && dy >= 2))) continue;
      const r = el.getBoundingClientRect();
      let outR = 0, outB = 0;
      for (const tr of textRects(el)) { outR = Math.max(outR, tr.right - r.right); outB = Math.max(outB, tr.bottom - r.bottom); }
      if (outR < 2 && outB < 2) continue;
      if (n >= 8) { extra++; continue; }
      findings.push({ severity: 'warn', rule: 'clipped-text',
        message: sel(el) + ' hides ' + (outB >= 2 ? Math.round(outB) + 'px of text below its box' : Math.round(outR) + 'px of text past its right edge'),
        selector: sel(el), box: box(r), text: snippet(el) });
      n++;
    }
    if (extra) rollup('clipped-text', 'warn', extra, 'clipped text block(s)');
  }

  // ── text-small: body text under 12px on mobile ─────────────────────────
  if (rules['text-small'] && isMobile) {
    let n = 0, extra = 0;
    for (const el of all) {
      if (!vis(el) || !ownText(el)) continue;
      if (el.closest('sup, sub, script, style')) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!(size < 12)) continue;
      if ((el.innerText || '').trim().length < 3) continue;
      if (n >= 10) { extra++; continue; }
      findings.push({ severity: 'warn', rule: 'text-small',
        message: sel(el) + ' is set at ' + size.toFixed(1) + 'px; body text under 12px is hard to read on a phone',
        selector: sel(el), box: box(el.getBoundingClientRect()), text: snippet(el) });
      n++;
    }
    if (extra) rollup('text-small', 'warn', extra, 'small-text block(s)');
  }

  // ── fixed-chrome: pinned bars eating the viewport ──────────────────────
  // vis() already drops off-canvas drawers, which is what made a hidden mobile
  // menu look like an 852px-tall fixed header.
  if (rules['fixed-chrome']) {
    let topH = 0, botH = 0; const parts = [];
    for (const el of all) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.5 || r.height < 10) continue;        // a bar spans the screen
      if (r.top <= 2 && r.bottom > 0) { topH = Math.max(topH, r.bottom); parts.push(sel(el)); }
      else if (r.bottom >= vh - 2 && r.top < vh) { botH = Math.max(botH, vh - r.top); parts.push(sel(el)); }
    }
    const share = (topH + botH) / vh;
    if (share > 0.25) findings.push({ severity: 'warn', rule: 'fixed-chrome',
      message: 'Fixed bars take ' + Math.round(share * 100) + '% of the viewport (' + Math.round(topH) + 'px top, ' + Math.round(botH) + 'px bottom of ' + vh + 'px)',
      selector: parts[0] || 'body', box: { x: 0, y: sy, width: vw, height: Math.round(topH) }, related: parts.slice(1).join(', ') });
  }

  // ── viewport-meta ──────────────────────────────────────────────────────
  if (rules['viewport-meta']) {
    const meta = document.querySelector('meta[name="viewport"]');
    const content = (meta && meta.getAttribute('content') || '').toLowerCase().replace(/\\s+/g, '');
    if (!meta) {
      findings.push({ severity: isMobile ? 'error' : 'warn', rule: 'viewport-meta',
        message: 'No <meta name="viewport">: phones lay the page out at desktop width and shrink it',
        selector: 'head', box: { x: 0, y: 0, width: vw, height: 1 } });
    } else if (/user-scalable=(no|0)/.test(content) || /maximum-scale=1(\\.0*)?(,|$)/.test(content)) {
      findings.push({ severity: 'warn', rule: 'viewport-meta',
        message: 'Viewport meta blocks zoom (' + content.slice(0, 80) + '); that fails WCAG 1.4.4 for low-vision users',
        selector: 'meta[name="viewport"]', box: { x: 0, y: 0, width: vw, height: 1 } });
    }
  }

  // ── offscreen: content parked outside the viewport ─────────────────────
  // Ambiguous by nature — left:-9999px is a common accessibility pattern — so
  // this is info, skips screen-reader shapes and anything inside a drawer or
  // menu, and reports only the outermost offscreen element.
  if (rules.offscreen) {
    let n = 0;
    for (const el of all) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 10) continue;                 // sr-only 1px shapes
      const off = r.right <= 0 || r.left >= vw;
      if (!off) continue;
      if (!(el.innerText || '').trim()) continue;
      if (inSlider(el)) continue;
      if (el.closest('nav, dialog, [role="dialog"], [role="menu"], [aria-hidden="true"], [hidden], [class*="menu" i], [class*="drawer" i], [class*="offcanvas" i], [class*="off-canvas" i], [class*="sidebar" i], [class*="sr-only" i], [class*="visually-hidden" i]')) continue;
      const p = el.parentElement;
      if (p && p !== document.body) { const pr = p.getBoundingClientRect(); if (pr.right <= 0 || pr.left >= vw) continue; }
      findings.push({ severity: 'info', rule: 'offscreen',
        message: sel(el) + ' sits entirely off screen (x ' + Math.round(r.left) + ' to ' + Math.round(r.right) + ') and is not marked hidden',
        selector: sel(el), box: box(r), text: snippet(el) });
      if (++n >= 6) break;
    }
  }

  // ── image-size: served resolution vs rendered size at this DPR ─────────
  if (rules['image-size']) {
    // Sharpness is judged against min(dpr, 2): a 2x asset on a 3x phone is the
    // universal practice and is not visibly soft, while a 1x asset is. Waste
    // is judged against the true dpr. Identical geometry (a gallery of
    // same-sized images) collapses to one finding with a count.
    const groups = new Map();
    for (const img of document.querySelectorAll('img')) {
      if (!vis(img) || !img.complete || !img.naturalWidth) continue;
      if (/\\.svg(\\?|$)/i.test(img.currentSrc || img.src || '')) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const cssW = Math.round(r.width);
      const sharpNeed = cssW * Math.min(dpr, 2), wasteNeed = cssW * dpr;
      let kind = null;
      if (img.naturalWidth < sharpNeed * 0.9) kind = 'soft';
      else if (img.naturalWidth > wasteNeed * 2) kind = 'waste';
      if (!kind) continue;
      const key = kind + '|' + img.naturalWidth + '|' + cssW;
      if (!groups.has(key)) groups.set(key, { kind, natural: img.naturalWidth, cssW, need: kind === 'soft' ? sharpNeed : wasteNeed, first: img, r, count: 0 });
      groups.get(key).count++;
    }
    let n = 0;
    for (const g of groups.values()) {
      const more = g.count > 1 ? ' (and ' + (g.count - 1) + ' more the same size)' : '';
      if (g.kind === 'soft') findings.push({ severity: 'warn', rule: 'image-size',
        message: sel(g.first) + ' is served at ' + g.natural + 'px for a ' + g.cssW + 'px slot on a ' + dpr + 'x screen — under ' + Math.round(g.need) + 'px it will look soft' + more,
        selector: sel(g.first), box: box(g.r), count: g.count });
      else findings.push({ severity: 'info', rule: 'image-size',
        message: sel(g.first) + ' is served at ' + g.natural + 'px for a ' + g.cssW + 'px slot on a ' + dpr + 'x screen — more than twice the ' + Math.round(g.need) + 'px this device can show' + more,
        selector: sel(g.first), box: box(g.r), count: g.count });
      if (++n >= 8) break;
    }
  }

  // ── cls: cumulative layout shift, from the observer armed before load ───
  let cls = null;
  if (rules.cls) {
    cls = (typeof window.__dpCLS === 'number') ? Math.round(window.__dpCLS * 1000) / 1000 : null;
    if (cls === null) {
      // not a finding: the engine cannot measure it, and a fake 0 would be a lie
    } else if (cls > 0.25) {
      findings.push({ severity: 'error', rule: 'cls', message: 'Cumulative layout shift ' + cls + ' — content jumps around while loading (poor is above 0.25)', selector: 'html', box: { x: 0, y: 0, width: vw, height: vh } });
    } else if (cls > 0.1) {
      findings.push({ severity: 'warn', rule: 'cls', message: 'Cumulative layout shift ' + cls + ' — some content moves while loading (good is 0.1 or under)', selector: 'html', box: { x: 0, y: 0, width: vw, height: vh } });
    } else {
      findings.push({ severity: 'info', rule: 'cls', message: 'Cumulative layout shift ' + cls + ' — stable while loading', selector: 'html', box: { x: 0, y: 0, width: vw, height: vh } });
    }
  }

  return { docOverflow, cls, findings };
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
                page.add_init_script(CLS_INIT_JS)
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
                    "stacks": fonts.get("stacks", []),
                    "requests": font_requests,
                    "failed_requests": [r for r in font_requests
                                        if r.get("status") is None or r["status"] >= 400],
                }
                if fonts.get("requestsAppleSystemFont"):
                    res.fonts["appleSystemFontRequested"] = True

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

                t_audit = time.time()
                audit = page.evaluate(AUDIT_JS, {
                    "rules": options.rules, "dpr": profile.device_scale_factor,
                    "hasTouch": profile.has_touch, "isMobile": profile.is_mobile,
                }) or {}
                res.findings = audit.get("findings", [])
                res.page["cls"] = audit.get("cls")
                if options.rules.get("cls") and audit.get("cls") is None:
                    res.notes.append("layout shift (CLS) is not measurable in this engine; "
                                     "see the Chromium profiles for that number")
                # Webfont findings need the network, which only Python saw.
                if options.rules.get("webfont"):
                    res.findings.extend(_font_findings(res.fonts, w, h))
                res.timings_ms["audit"] = int((time.time() - t_audit) * 1000)

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


def _font_findings(fonts: dict[str, Any], vw: int, vh: int) -> list[dict[str, Any]]:
    """Webfont findings from the network record and the measured font stacks.

    The unit is a STACK — the font-family/weight/style some element's own text
    is set in — and the question is whether the page's webfonts in it are the
    ones drawing. FONTS_JS answers by measurement: probe text inheriting the
    stack against the same text with the page's @font-face families removed.
    Equal widths mean fallback. FontFace status is never evidence of failure
    (WebKit reported "error" on faces it was plainly drawing); it serves only
    as a veto — a stack with a loaded declaration is not a fallback even when
    its metrics coincide with the generic face, as a local() twin's do — and to
    word the finding: refused before the network versus rejected after it.
    A failed request is an error only when some text really is in a fallback;
    otherwise it is a dead declaration worth a warning, never a failed build."""
    out: list[dict[str, Any]] = []
    whole = {"x": 0, "y": 0, "width": vw, "height": vh}
    stacks = fonts.get("stacks") or []

    def _loaded(st: dict[str, Any]) -> bool:
        return any(v in ("loaded", "loading") for vals in (st.get("status") or {}).values() for v in vals)

    fallback = [st for st in stacks if st.get("renders") is False and not _loaded(st)]
    # One finding per leading family, however many weights it is used at.
    by_family: dict[str, dict[str, Any]] = {}
    for st in fallback:
        lead = (st.get("declared") or ["?"])[0]
        g = by_family.setdefault(lead, {"elements": 0, "sample": st.get("sample"), "statuses": set()})
        g["elements"] += int(st.get("elements") or 0)
        g["statuses"].update(v for vals in (st.get("status") or {}).values() for v in vals)

    failed = (fonts.get("failed_requests") or [])[:6]
    for r in failed:
        why = r.get("failure") or (f"HTTP {r['status']}" if r.get("status") else "failed")
        name = r["url"].rsplit("/", 1)[-1][:60]
        if by_family:
            out.append({"severity": "error", "rule": "webfont",
                        "message": f"Webfont failed to load: {name} — {why}",
                        "selector": "head", "box": whole, "url": r["url"]})
        else:
            out.append({"severity": "warn", "rule": "webfont",
                        "message": f"Declared webfont source {name} failed ({why}), but every element that "
                                   "asks for it is still drawn in one of the page's own fonts — a dead "
                                   "declaration, not a fallback",
                        "selector": "head", "box": whole, "url": r["url"]})

    for fam, g in list(by_family.items())[:4]:
        n = g["elements"]; where = f"{n} element{'s' if n != 1 else ''} (e.g. <{g['sample']}>)"
        if "error" not in g["statuses"]:
            out.append({"severity": "warn", "rule": "webfont",
                        "message": f"{fam} is used by the page but never loaded (no request was made — refused "
                                   f"before the network); {where} measure as their fallback face",
                        "selector": g["sample"] or "body", "box": whole, "family": fam})
        elif failed:
            continue                       # the failed request above is the finding
        else:
            out.append({"severity": "warn", "rule": "webfont",
                        "message": f"{fam} is not being drawn by this engine (its declarations are in error "
                                   f"though every request succeeded); {where} measure as their fallback face",
                        "selector": g["sample"] or "body", "box": whole, "family": fam})

    if fonts.get("appleSystemFontRequested"):
        out.append({"severity": "info", "rule": "webfont",
                    "message": "Page requests Apple's system font (-apple-system / SF Pro); it is "
                               "substituted on this backend, so the typography is not authentic",
                    "selector": "body", "box": whole})
    return out

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


def summarise(results: list[CaptureResult]) -> dict[str, Any]:
    sev = {"error": 0, "warn": 0, "info": 0}
    with_errors: list[str] = []
    for r in results:
        if any(f["severity"] == "error" for f in r.findings):
            with_errors.append(r.profile_id)
        for f in r.findings:
            sev[f["severity"]] = sev.get(f["severity"], 0) + 1
    return {"errors": sev["error"], "warnings": sev["warn"], "infos": sev["info"],
            "devicesWithErrors": with_errors,
            "devicesPassed": len(results) - len(with_errors)}


def load_rules(disable: str) -> dict[str, bool]:
    """All rules on by default. A devicepreview.config.json beside devices.json
    may switch some off ({"rules": {"tap-close": false}}); --disable-rule
    switches more off for one run. Unknown names are an error, not a silent
    no-op — a typo must not quietly re-enable a rule someone meant to drop."""
    rules = dict(DEFAULT_RULES)
    cfg_path = HERE / "devicepreview.config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        for k, v in (cfg.get("rules") or {}).items():
            if k not in rules:
                raise SystemExit(f"devicepreview.config.json: unknown rule {k!r}. "
                                 f"Known: {', '.join(rules)}")
            rules[k] = bool(v)
    for k in (x.strip() for x in disable.split(",") if x.strip()):
        if k not in rules:
            raise SystemExit(f"--disable-rule: unknown rule {k!r}. Known: {', '.join(rules)}")
        rules[k] = False
    return rules


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
    ap.add_argument("--max-scroll-viewports", type=int, default=5, metavar="N",
                    help="lazy-load trigger: scroll at most N viewport heights (default 5; a "
                         "12000px page on a 750px phone needs about 16 to load everything)")
    ap.add_argument("--out", help="default: ./runs/<timestamp>")
    ap.add_argument("--json", action="store_true", help="print report.json path only")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--disable-rule", default="", metavar="RULE,RULE",
                    help=f"switch audit rules off for this run; known: {', '.join(DEFAULT_RULES)}")
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
    base_opts = CaptureOptions(out_dir=out_dir, landscape=args.landscape, timeout_s=args.timeout,
                               max_scroll_viewports=args.max_scroll_viewports,
                               rules=load_rules(args.disable_rule))

    started = datetime.now(timezone.utc)
    say(f"  {len(chosen)} device(s) × {len(schemes)} scheme(s), "
        f"{len({p.engine for p in chosen})} engine(s) in parallel")
    results, timing = run_matrix(url, chosen, schemes, base_opts, args.backend,
                                 args.concurrency, say)

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "tool": {"name": "devicepreview", "version": TOOL_VERSION, "step": 4},
        "url": url,
        "startedAt": started.isoformat(timespec="seconds"),
        "finishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "backend": args.backend,
        "options": {"landscape": args.landscape, "colorScheme": args.color_scheme,
                    "timeoutSeconds": args.timeout, "concurrency": args.concurrency},
        "timing": timing,
        "rules": base_opts.rules,
        "summary": summarise(results),
        "devices": [asdict(r) for r in results],
        "unverifiedProfiles": sorted({r.profile_id for r in results if not r.verified}),
        "fidelityNote": ("The local backend uses real browser engines, not real devices. "
                         "Layout, breakpoints and overflow are accurate; font rasterisation, "
                         "scroll physics and OS animation timing are not. See LIMITATIONS.md."),
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    failed = [r for r in results if r.status != "ok"]
    summary = report["summary"]
    if args.json:
        print(out_dir / "report.json")
    else:
        say(f"\n  {len(results)} capture(s), {len(failed)} failed, "
            f"{summary['errors']} error(s), {summary['warnings']} warning(s), "
            f"{timing['wallMs'] / 1000:.1f}s wall → {out_dir}/report.json")
        for r in results:
            for f in r.findings:
                if f["severity"] == "error":
                    say(f"    {r.label:26} {f['rule']:14} {f['message'][:90]}")
    # 0 clean, 1 any error-severity finding, 2 tool failure. Failure wins: a
    # run that could not capture cannot vouch for anything.
    return 2 if failed else (1 if summary["errors"] else 0)


if __name__ == "__main__":
    sys.exit(main())
