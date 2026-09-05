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
from html import escape as html_escape
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
    status: str = "ok"                    # ok | failed | blocked (a bot wall or error page was served instead)
    error: str | None = None
    viewport: dict[str, int] = field(default_factory=dict)
    device_scale_factor: float = 1.0
    landscape: bool = False
    color_scheme: str = "light"
    is_mobile: bool = False
    has_touch: bool = False
    images: dict[str, str] = field(default_factory=dict)   # fold | full | thumb -> path relative to the run dir
    timings_ms: dict[str, int] = field(default_factory=dict)
    fonts: dict[str, Any] = field(default_factory=dict)
    fixed_chrome: list[dict[str, Any]] = field(default_factory=list)
    page: dict[str, Any] = field(default_factory=dict)      # scrollWidth, scrollHeight, title
    notes: list[str] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)   # step 3
    # Baseline comparison (step 6) fills this; reserved now so report.json's
    # shape does not change when it lands.
    diff: dict[str, Any] | None = None


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
  // font-family/weight/style that some element's OWN text is set in, take the
  // text already painted in one such element — a Range over its first text
  // run, on one line — and measure the same characters, inheriting everything
  // but font-family, in the stack with the page's @font-face families struck
  // out. Equal widths mean the painted glyphs ARE the fallback. This is the
  // only honest witness: on WebKit a fresh probe run in the same stack once
  // measured as the fallback, and every FontFace of the family read "error",
  // while the screenshot — and the painted paragraphs — were unmistakably the
  // webfont. What is on screen is what the visitor sees; measure that.
  // Containers are skipped (a div whose innerText comes from children with
  // their own font-family draws no glyphs), which is how 52 wrappers once made
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
  // The painted witness: the first text run of the element that sits on one
  // line (a Range across a soft wrap returns one rect per line, so shrink
  // until there is exactly one). Returns the characters and their painted width.
  const painted = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const txt = n.textContent, m = txt.match(/\\S[^\\n]{5,}/);
      if (!m) continue;
      const start = m.index;
      for (let len = Math.min(m[0].length, 40); len >= 6; len = Math.floor(len * 0.7)) {
        const r = document.createRange(); r.setStart(n, start); r.setEnd(n, start + len);
        const rects = r.getClientRects();
        if (rects.length === 1 && rects[0].width > 0) return { text: txt.slice(start, start + len), width: rects[0].width };
      }
    }
    return null;
  };
  // The same characters, inheriting size, weight, style, spacing and
  // transform from the element, in a different family list.
  const measure = (host, ff, text) => {
    const sp = document.createElement('span');
    sp.textContent = text;
    sp.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-family:' + ff;
    host.appendChild(sp);
    const w = sp.getBoundingClientRect().width;
    sp.remove();
    return w;
  };
  const PROBE = 'mmmmmmmmmmlliIWw0';
  const stackOut = [];
  for (const st of stacks.values()) {
    const decl = st.families.filter(f => declared.has(bare(f)));
    const without = st.families.filter(f => !declared.has(bare(f)));
    // A stack with no generic tail falls to the UA default face; compare
    // against serif, which is that default in every engine we run.
    if (!without.some(f => GENERIC.test(bare(f)))) without.push('serif');
    let renders = null, run = null, freshMatchesPainted = null;
    try {
      run = painted(st.el);
      if (run) {
        const wo = measure(st.el, without.join(', '), run.text);
        const tol = Math.max(1, run.width * 0.01);
        renders = wo > 0 ? Math.abs(run.width - wo) >= tol : null;
        // Diagnostic only: would text laid out NOW get the same face as the
        // text already on screen? False is the WebKit state described above.
        const wi = measure(st.el, 'inherit', run.text);
        freshMatchesPainted = wi > 0 ? Math.abs(run.width - wi) < tol : null;
      } else {
        // No single-line run to witness (text split across many nodes):
        // fall back to comparing two fresh probe runs.
        const w = measure(st.el, 'inherit', PROBE), wo = measure(st.el, without.join(', '), PROBE);
        renders = (w > 0 && wo > 0) ? Math.abs(w - wo) >= 0.5 : null;
      }
    } catch (e) {}
    const status = {};
    try { for (const f of document.fonts) { const k = bare(String(f.family)); if (decl.some(d => bare(d) === k)) (status[k] = status[k] || []).push(f.status); } } catch (e) {}
    const el = st.el;
    const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\\s+/)[0] : '';
    stackOut.push({ stack: st.stack, weight: st.weight, style: st.style, elements: st.elements,
      sample: (el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls)).slice(0, 60),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      declared: decl.map(d => d.trim().replace(/^["']|["']$/g, '')), status, renders,
      witness: run ? run.text.slice(0, 40) : null, freshMatchesPainted });
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
  userAgent: navigator.userAgent,
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
  innerWidth: window.innerWidth, innerHeight: window.innerHeight,
})"""


# A bot wall or an error page is not the site. Auditing one produced "2 info,
# passed" for a Cloudflare "Sorry, you have been blocked" page on the first
# real gallery run — the exact false PASS this tool exists to prevent. The
# body-text test applies only to short pages, so an article that mentions
# "access denied" is not mistaken for one.
BLOCK_JS = """() => {
  const t = (document.title || '').toLowerCase();
  const b = ((document.body && document.body.innerText) || '').slice(0, 4000).toLowerCase().replace(/\\s+/g, ' ');
  const hit = document.querySelector('#cf-error-details, #cf-wrapper, .cf-error-overview, #challenge-running, '
    + '#challenge-form, #challenge-stage, iframe[src*="challenges.cloudflare.com"], #px-captcha, #_pxCaptcha, '
    + '.h-captcha, #captcha-container, #sec-cpt-if, #distil_ident_block, #ddg-challenge, iframe[src*="_Incapsula_Resource"]');
  const titleHit = /just a moment|attention required|you have been blocked|access denied|are you a robot|verify you are human|security check|checking your browser|pardon our interruption|bot verification|ddos-guard|request unsuccessful/.test(t);
  const bodyHit = b.length < 2500 && /sorry, you have been blocked|you have been blocked|verify you are human|checking if the site connection is secure|enable javascript and cookies to continue|pardon our interruption|incapsula incident|request blocked|access denied|performing a security check/.test(b);
  if (!hit && !titleHit && !bodyHit) return { blocked: false };
  const why = hit ? 'matched ' + (hit.id ? '#' + hit.id : (hit.className || hit.tagName.toLowerCase()))
            : titleHit ? 'title "' + (document.title || '').slice(0, 60) + '"' : 'the body text reads as a block page';
  return { blocked: true, why };
}"""


class _Blocked(Exception):
    """Raised inside a capture when the served page is a wall, not the site."""


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
        self._ua: dict[str, str] = {}

    def _browser(self, engine: str) -> Browser:
        if engine not in self._browsers:
            launcher = getattr(self._pw, engine)
            self._browsers[engine] = launcher.launch()
        return self._browsers[engine]

    def _default_ua(self, engine: str) -> str | None:
        """The engine's own user agent, with "HeadlessChrome" renamed to "Chrome".

        Cloudflare served the desktop-1440-chrome profile a block page on its
        first real run: a null-UA profile announces HeadlessChrome, while the
        mobile Chromium profile, whose descriptor carries a real UA, got
        through. Read once per engine from the running browser rather than
        pinned in devices.json, so the version never rots. Only Chromium marks
        itself headless; Firefox and WebKit are left as they are."""
        if engine != "chromium":
            return None
        if engine not in self._ua:
            ctx = self._browser(engine).new_context()
            try:
                ua = ctx.new_page().evaluate("navigator.userAgent")
            finally:
                ctx.close()
            self._ua[engine] = ua.replace("HeadlessChrome", "Chrome")
        return self._ua[engine]

    @contextmanager
    def _context(self, profile: Profile, options: CaptureOptions) -> Iterator[BrowserContext]:
        ctx_opts = profile.context_options(options.landscape)
        if "user_agent" not in ctx_opts:
            ua = self._default_ua(profile.engine)
            if ua:
                ctx_opts["user_agent"] = ua
        ctx = self._browser(profile.engine).new_context(
            **ctx_opts,
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
            is_mobile=profile.is_mobile, has_touch=profile.has_touch,
        )
        t_start = time.time()
        font_requests: list[dict[str, Any]] = []
        suffix = ("-landscape" if options.landscape else "") + (
            "-dark" if options.color_scheme == "dark" else "")

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
                response = page.goto(url, wait_until="domcontentloaded", timeout=options.timeout_s * 1000)
                main_status = response.status if response is not None else None
                # A challenge page polls forever and never goes network-idle;
                # recognise it now rather than after the full idle timeout.
                early = page.evaluate(BLOCK_JS) or {}
                wall_why = None
                if early.get("blocked") or main_status in (403, 429, 503):
                    wall_why = early.get("why") or f"HTTP {main_status} for the main document"
                    page.wait_for_timeout(300)   # let the wall paint before it is photographed
                try:
                    page.wait_for_load_state("networkidle", timeout=options.timeout_s * 1000 if wall_why is None else 1)
                except PWTimeout:
                    # A page that polls or streams never goes idle. Degrade to a
                    # fixed settle rather than failing a capture that is fine.
                    page.wait_for_timeout(options.settle_ms)
                    res.notes.append(f"networkidle not reached in {options.timeout_s:.0f}s; "
                                     f"settled {options.settle_ms}ms instead")
                res.timings_ms["navigate"] = int((time.time() - t0) * 1000)
                res.final_url = page.url

                # Is this the site, or a wall in front of it? Decide before any
                # audit runs: findings about a block page are findings about
                # nothing. The wall itself is kept as evidence.
                wall = {} if wall_why else (page.evaluate(BLOCK_JS) or {})
                if wall_why or wall.get("blocked"):
                    out = options.out_dir / profile.id
                    out.mkdir(parents=True, exist_ok=True)
                    fold = out / f"fold{suffix}.png"
                    page.screenshot(path=str(fold))
                    res.images["fold"] = _rel(fold, options.out_dir)
                    res.page = page.evaluate(PAGE_JS) or {}
                    raise _Blocked(wall_why or wall.get("why"))

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
                # A finding about the document (viewport meta, layout shift,
                # a font, the page scrolling sideways) has no place on the
                # page to point at; a viewport-sized box drawn over the fold
                # implied one and hid what was under it.
                for f in res.findings:
                    if f.get("selector") in ("html", "head", "body"):
                        f["scope"] = "page"
                res.timings_ms["audit"] = int((time.time() - t_audit) * 1000)

                t2 = time.time()
                out = options.out_dir / profile.id
                out.mkdir(parents=True, exist_ok=True)
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
                # Relative to the run directory, so report.html beside them can
                # reference the files and the whole folder can be zipped and
                # opened anywhere.
                res.images["fold"] = _rel(fold, options.out_dir)
                res.images["full"] = _rel(full, options.out_dir)
                if any(c["edge"] == "top" for c in res.fixed_chrome):
                    res.notes.append("fixed/sticky header present — some engines repeat it down "
                                     "a full-page capture; check the full image before trusting it")

                thumb = _thumbnail(fold, out / f"thumb{suffix}.png", options.thumb_width)
                if thumb:
                    res.images["thumb"] = _rel(thumb, options.out_dir)
                else:
                    res.notes.append("no thumbnail: Pillow not importable; gallery will scale "
                                     "the fold capture instead")
                res.timings_ms["screenshots"] = int((time.time() - t2) * 1000)
        except _Blocked as exc:
            res.status = "blocked"
            res.error = f"a bot wall or error page was served instead of the site ({exc}); nothing was audited"
        except PWTimeout as exc:
            res.status, res.error = "failed", f"timeout: {_first_line(exc)}"
        except PWError as exc:
            res.status, res.error = "failed", f"{type(exc).__name__}: {_first_line(exc)}"

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

def _first_line(exc: BaseException) -> str:
    """Playwright appends a multi-line call log to every message; the first
    line is the fact, the rest is noise in a report."""
    return str(exc).split("\n", 1)[0].strip()[:200]


def _rel(path: Path, base: Path) -> str:
    try:
        return path.relative_to(base).as_posix()
    except ValueError:                     # a backend wrote somewhere else; keep the truth
        return path.as_posix()


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
    if first.status != "failed":
        return first                       # ok, or blocked — a wall is an answer, not a flake
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
    results.sort(key=lambda r: (order.get(r.profile_id, 999), r.color_scheme != "light", r.landscape))
    return results, {"wallMs": int((time.time() - t0) * 1000), "workers": workers,
                     "perEngineMs": engine_ms}


def summarise(results: list[CaptureResult]) -> dict[str, Any]:
    sev = {"error": 0, "warn": 0, "info": 0}
    with_errors: list[str] = []
    with_warnings: list[str] = []
    failed: list[str] = []
    blocked: list[str] = []
    for r in results:
        if r.status == "failed":
            failed.append(r.profile_id)
        elif r.status == "blocked":
            blocked.append(r.profile_id)
        if any(f["severity"] == "error" for f in r.findings):
            with_errors.append(r.profile_id)
        elif any(f["severity"] == "warn" for f in r.findings):
            with_warnings.append(r.profile_id)
        for f in r.findings:
            sev[f["severity"]] = sev.get(f["severity"], 0) + 1
    # A capture that failed vouches for nothing, so it is neither passed nor
    # counted against the page; it is listed on its own.
    passed = [r.profile_id for r in results if r.status == "ok" and r.profile_id not in with_errors]
    return {"errors": sev["error"], "warnings": sev["warn"], "infos": sev["info"],
            "devicesWithErrors": with_errors, "devicesWithWarnings": with_warnings,
            "devicesFailed": failed, "devicesBlocked": blocked, "devicesPassed": len(passed)}


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


# ── report.html ─────────────────────────────────────────────────────────────

REPORT_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>devicepreview · __TITLE__</title>
<style>
:root{
  --bg:#f2f4f8;--surface:#ffffff;--surface-2:#eaeef4;--ink:#161a21;--muted:#5b6473;--faint:#8a93a3;--line:#dde2ea;--line-2:#c9d1dc;
  --accent:#2f4fd0;--accent-ink:#ffffff;--accent-soft:#e4e9fb;
  --err:#bf2a2a;--err-soft:#fbe8e6;--warn:#9c5a00;--warn-soft:#fff2da;--info:#2b67ad;--info-soft:#e6eefb;--ok:#1d7f4f;--ok-soft:#e1f4e8;--wall:#262a31;--wall-soft:#e3e6eb;
  --frame:#14171c;--shadow:0 1px 2px rgba(22,26,33,.06),0 10px 28px rgba(22,26,33,.09);--ring:0 0 0 3px var(--accent-soft);
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e1116;--surface:#161a21;--surface-2:#1d222b;--ink:#e6eaf1;--muted:#9aa4b5;--faint:#6b7585;--line:#28303b;--line-2:#374050;
  --accent:#8aa4ff;--accent-ink:#0e1116;--accent-soft:#222b45;
  --err:#ff7373;--err-soft:#3b1c1c;--warn:#f1b53a;--warn-soft:#3a2d12;--info:#78adff;--info-soft:#1a2740;--ok:#55c78f;--ok-soft:#16321f;--wall:#c9cfd9;--wall-soft:#2a3039;
  --frame:#04060a;--shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.4);--ring:0 0 0 3px #2c3a66;
}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
button{font:inherit;color:inherit}
code,.mono{font-family:var(--mono);font-size:.86em}
.num{font-variant-numeric:tabular-nums}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;left:-9999px}

/* ── verdict header ─────────────────────────────────────────────── */
.top{background:var(--surface);border-bottom:1px solid var(--line)}
.top .in{max-width:1640px;margin:0 auto;padding:22px 28px 18px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px 32px;align-items:start}
.verdict{display:flex;gap:14px;align-items:flex-start}
.verdict .mark{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:20px;font-weight:700;color:#fff}
.verdict h1{margin:0;font-size:22px;line-height:1.2;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
.verdict .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
.verdict .sub a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line-2);word-break:break-all}
.verdict .sub a:hover{border-color:var(--ink)}
.tone-err .mark{background:var(--err)}.tone-warn .mark{background:var(--warn)}.tone-ok .mark{background:var(--ok)}.tone-wall .mark{background:var(--wall)}
.stats{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-self:center}
.stat{display:flex;flex-direction:column;align-items:flex-start;padding:8px 14px;border-radius:10px;background:var(--surface-2);min-width:88px}
.stat b{font-size:20px;font-weight:650;line-height:1.1}
.stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.stat.err{background:var(--err-soft)}.stat.err b{color:var(--err)}
.stat.warn{background:var(--warn-soft)}.stat.warn b{color:var(--warn)}
.stat.ok{background:var(--ok-soft)}.stat.ok b{color:var(--ok)}
.stat.wall{background:var(--wall-soft)}.stat.wall b{color:var(--wall)}

/* ── toolbar ───────────────────────────────────────────────────── */
main{max-width:1640px;margin:0 auto;padding:16px 28px 40px}
.bar{display:flex;gap:10px 18px;align-items:center;flex-wrap:wrap;padding:6px 0 14px}
.seg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px}
.seg button{border:0;background:transparent;padding:6px 11px;border-radius:7px;cursor:pointer;color:var(--muted);display:inline-flex;gap:6px;align-items:center}
.seg button .n{font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}
.seg button.on{background:var(--surface-2);color:var(--ink)}
.seg button.on .n{color:var(--muted)}
.seg button[disabled]{opacity:.4;cursor:default}
.chips{display:inline-flex;gap:6px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 11px;cursor:pointer;color:var(--muted);display:inline-flex;gap:6px;align-items:center}
.chip.on{border-color:var(--accent);color:var(--ink);background:var(--accent-soft)}
.chip .n{font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}
.grow{flex:1}
.btn{border:1px solid var(--line);background:var(--surface);padding:7px 13px;border-radius:9px;cursor:pointer}
.btn:hover{border-color:var(--line-2)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn[disabled]{opacity:.45;cursor:default}
.hint{color:var(--muted);font-size:12px}

/* ── groups + cards ─────────────────────────────────────────────── */
.groups{display:flex;flex-wrap:wrap;gap:26px 30px;align-items:flex-start}
.group{flex:0 1 auto;max-width:100%}
.group h2{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);font-weight:600;display:flex;gap:8px;align-items:baseline}
.group h2 .n{color:var(--faint);font-weight:500;letter-spacing:0;text-transform:none}
.cards{display:flex;flex-wrap:wrap;gap:14px}
.card{position:relative;width:236px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 12px 12px 16px;box-shadow:0 1px 2px rgba(22,26,33,.04);transition:box-shadow .15s,transform .15s;overflow:hidden}
.card:hover{box-shadow:var(--shadow)}
.card .stripe{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--ok)}
.card.sev-error .stripe{background:var(--err)}.card.sev-warn .stripe{background:var(--warn)}.card.sev-info .stripe{background:var(--info)}.card.sev-wall .stripe,.card.sev-fail .stripe{background:var(--wall)}
.card.sev-fail{border-style:dashed}
.card.selected{border-color:var(--accent);box-shadow:var(--ring)}
.card .head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px}
.card .name{font-weight:620;font-size:13.5px;line-height:1.25}
.card .sub{color:var(--muted);font-size:11.5px;margin-top:2px}
.card .pickw{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;user-select:none;padding:2px 0 2px 6px}
.card .pick{width:15px;height:15px;margin:0;accent-color:var(--accent);cursor:pointer}
.card .open{display:block;width:100%;border:0;background:transparent;padding:0;cursor:zoom-in;text-align:left;border-radius:10px}
.frame{background:var(--frame);border-radius:12px;padding:8px;margin:0 auto}
.frame.phone{border-radius:24px;padding:16px 9px;max-width:168px}
.frame.tablet{border-radius:16px;padding:12px;max-width:196px}
.frame.desktop{border-radius:8px 8px 3px 3px;padding:7px 7px 12px}
.screen{background:#fff;overflow:hidden;border-radius:4px;width:100%;position:relative;max-height:300px}
.frame.phone .screen{border-radius:14px}
.screen img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.screen .nope{display:flex;align-items:center;justify-content:center;height:100%;min-height:90px;color:#7d8694;font-size:11px;padding:8px;text-align:center;background:#f4f5f7}
.badges{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap;align-items:center}
.b{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;font-variant-numeric:tabular-nums}
.b.err{background:var(--err-soft);color:var(--err)}.b.warn{background:var(--warn-soft);color:var(--warn)}.b.info{background:var(--info-soft);color:var(--info)}.b.ok{background:var(--ok-soft);color:var(--ok)}.b.fail{background:var(--wall);color:#fff}.b.unv{background:var(--surface-2);color:var(--muted);font-weight:500}
.card .worst{margin:9px 0 0;font-size:12px;line-height:1.4;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .worst .r{font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-right:6px}
.empty{color:var(--muted);padding:40px 0;text-align:center}

/* ── detail dialog ─────────────────────────────────────────────── */
.dialog{position:fixed;inset:0;background:rgba(10,13,18,.72);display:none;z-index:20;padding:18px}
.dialog.open{display:block}
.panel{background:var(--surface);border-radius:16px;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;box-shadow:var(--shadow)}
.dhead{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.dhead h2{margin:0;font-size:16px;font-weight:650}
.dhead .meta{color:var(--muted);font-size:12px;margin-top:1px}
.nav{border:1px solid var(--line);background:var(--surface);width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px;line-height:1;display:grid;place-items:center}
.nav[disabled]{opacity:.35;cursor:default}
.dtools{margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.tog{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer;user-select:none}
.tog input{accent-color:var(--accent);margin:0}
.lnk{font-size:12.5px;color:var(--muted)}
.dbody{display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:0}
.shot{overflow:auto;background:var(--surface-2);padding:20px;min-height:0}
.wrap{position:relative;width:var(--zw);margin:0 auto;box-shadow:0 2px 14px rgba(0,0,0,.18);background:#fff}
.wrap img{display:block;width:100%}
.wrap.noov .box{display:none}
.box{position:absolute;border:2px solid var(--info);background:rgba(43,103,173,.13);cursor:pointer;box-sizing:border-box}
.box.err{border-color:var(--err);background:rgba(191,42,42,.14)}.box.warn{border-color:var(--warn);background:rgba(156,90,0,.14)}
.box.hot{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--accent);z-index:2}
.box.dim{opacity:.25}
.side{border-left:1px solid var(--line);overflow:auto;min-height:0;padding:0 16px 20px}
.side h4{margin:18px 0 8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;display:flex;gap:8px;align-items:baseline}
.side h4 .n{color:var(--faint);font-weight:500;letter-spacing:0;text-transform:none}
.sevbar{position:sticky;top:0;background:var(--surface);padding:12px 0 10px;border-bottom:1px solid var(--line);display:flex;gap:6px;flex-wrap:wrap;z-index:1}
.f{border:1px solid var(--line);border-left-width:4px;border-radius:9px;padding:8px 10px;margin-bottom:8px;cursor:pointer;font-size:12.5px;background:var(--surface)}
.f.err{border-left-color:var(--err)}.f.warn{border-left-color:var(--warn)}.f.info{border-left-color:var(--info)}
.f.hot{background:var(--accent-soft)}
.f.hide{display:none}
.f .rule{display:flex;gap:6px;align-items:center;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:3px;font-family:var(--mono)}
.f .rule .sv{width:7px;height:7px;border-radius:50%;background:var(--info)}
.f.err .rule .sv{background:var(--err)}.f.warn .rule .sv{background:var(--warn)}
.f code{display:block;margin-top:5px;color:var(--muted);word-break:break-all}
.note{font-size:12.5px;color:var(--muted);margin:4px 0;line-height:1.45}
.state{border-radius:10px;padding:12px 14px;margin-top:14px;font-size:13px;line-height:1.45}
.state.wall{background:var(--wall-soft)}.state.fail{background:var(--err-soft)}
.state b{display:block;margin-bottom:4px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12.5px;color:var(--muted)}
.kv b{color:var(--ink);font-weight:500}
.diffimg{width:100%;border:1px solid var(--line);border-radius:6px;margin-top:6px}

/* ── compare ──────────────────────────────────────────────────── */
.compare{display:none;grid-template-columns:1fr 1fr;gap:16px;margin:4px 0 26px}
.compare.open{display:grid}
.compare .ch{grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.compare select{font:inherit;color:inherit;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:6px 8px;max-width:260px}
.pane{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pane .ph{padding:10px 14px;border-bottom:1px solid var(--line);font-weight:600;font-size:13px;display:flex;justify-content:space-between;gap:8px}
.pane .ph .meta{color:var(--muted);font-weight:500}
.pane .pb{overflow:auto;max-height:78vh;background:var(--surface-2);padding:14px}
.pane .wrap{width:min(100%,var(--zw))}

/* ── footer ───────────────────────────────────────────────────── */
footer{border-top:1px solid var(--line);background:var(--surface)}
footer .in{max-width:1640px;margin:0 auto;padding:22px 28px 30px;color:var(--muted);font-size:12.5px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px 40px}
footer p{margin:0;line-height:1.5;max-width:70ch}
footer b{color:var(--ink);font-weight:600}

@media (max-width:980px){
  .top .in{grid-template-columns:1fr}.stats{justify-content:flex-start}
  .dbody{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.side{border-left:0;border-top:1px solid var(--line);max-height:42vh}
  .compare{grid-template-columns:1fr}
}
@media (max-width:560px){.top .in,main,footer .in{padding-left:16px;padding-right:16px}.card{width:100%}.dialog{padding:0}.panel{border-radius:0}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>
</head>
<body>
<header class="top"><div class="in"><div class="verdict" id="verdict"></div><div class="stats" id="stats"></div></div></header>
<main>
  <nav class="bar" id="bar" aria-label="Filters"></nav>
  <section id="compare" class="compare" aria-live="polite"></section>
  <div id="groups" class="groups"></div>
  <p id="empty" class="empty" hidden></p>
</main>
<div id="detail" class="dialog" role="dialog" aria-modal="true" aria-labelledby="dtitle"></div>
<footer><div class="in" id="foot"></div></footer>
<script id="dp-data" type="application/json">__DATA__</script>
<script>
(() => {
const R = JSON.parse(document.getElementById('dp-data').textContent);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SEVN = {error: 0, warn: 1, info: 2};
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
const ms = v => v >= 1000 ? (v / 1000).toFixed(1) + 's' : v + 'ms';
const PLATFORM = {ios: 'iOS phones', ipados: 'iPadOS tablets', android: 'Android', desktop: 'Desktop'};
const ENGINE = {webkit: 'WebKit', chromium: 'Chromium', firefox: 'Firefox'};

// ── model ──────────────────────────────────────────────────────────
const count = d => { const c = {error: 0, warn: 0, info: 0}; for (const f of d.findings || []) c[f.severity] = (c[f.severity] || 0) + 1; return c; };
// Worst first. A blocked or failed capture outranks everything: it cannot
// vouch for the page at all. Then errors, warnings, infos; ties keep matrix order.
const score = d => { const c = count(d); return (d.status !== 'ok' ? 1e9 : 0) + c.error * 1e6 + c.warn * 1e3 + c.info; };
const worstSev = d => d.status === 'blocked' ? 'wall' : d.status !== 'ok' ? 'fail' : d._c.error ? 'error' : d._c.warn ? 'warn' : d._c.info ? 'info' : 'ok';
const devs = R.devices.map((d, i) => { const c = count(d); return {...d, _i: i, _c: c, _s: score(d),
  _key: d.profile_id + (d.color_scheme !== 'light' ? '-' + d.color_scheme : '') + (d.landscape ? '-landscape' : ''),
  _variant: [d.color_scheme !== 'light' ? d.color_scheme : '', d.landscape ? 'landscape' : ''].filter(Boolean).join(' · '),
  _shape: d.is_mobile ? (Math.min(d.viewport.width, d.viewport.height) < 600 ? 'phone' : 'tablet') : 'desktop'}; });
devs.forEach(d => { d._sev = worstSev(d); d._worst = (d.findings || []).slice().sort((a, b) => (SEVN[a.severity] ?? 9) - (SEVN[b.severity] ?? 9))[0] || null; });
const byKey = Object.fromEntries(devs.map(d => [d._key, d]));
const nDevices = new Set(devs.map(d => d.profile_id)).size, multi = devs.length !== nDevices;
const unit = multi ? 'capture' : 'device';
const platforms = [...new Set(devs.map(d => d.platform))];
const state = {sev: 'all', platforms: new Set(platforms), sort: 'worst', picks: []};

// ── verdict header ─────────────────────────────────────────────────
{
  const s = R.summary, errDev = new Set(devs.filter(d => d._c.error).map(d => d.profile_id)).size;
  const blocked = devs.filter(d => d.status === 'blocked').length, failed = devs.filter(d => d.status === 'failed').length;
  let tone, mark, line;
  if (s.errors) { tone = 'err'; mark = '!'; line = `${plural(s.errors, 'ship-blocking issue')} on ${errDev} of ${nDevices} devices`; }
  else if (blocked) { tone = 'wall'; mark = '⊘'; line = `Blocked by bot protection on ${plural(blocked, unit)}`; }
  else if (failed) { tone = 'wall'; mark = '×'; line = `${plural(failed, 'capture')} failed — nothing to vouch for there`; }
  else if (s.warnings) { tone = 'warn'; mark = '~'; line = `No errors · ${plural(s.warnings, 'warning')} to review`; }
  else { tone = 'ok'; mark = '✓'; line = `All ${nDevices} devices clean`; }
  const extras = [];
  if (s.errors && blocked) extras.push(`${plural(blocked, unit)} blocked`);
  if ((s.errors || blocked) && failed) extras.push(`${plural(failed, 'capture')} failed`);
  const started = new Date(R.startedAt);
  $('#verdict').className = 'verdict tone-' + tone;
  $('#verdict').innerHTML = `<div class="mark" aria-hidden="true">${mark}</div><div>
    <h1>${esc(line)}${extras.length ? ' · ' + esc(extras.join(' · ')) : ''}</h1>
    <p class="sub"><a href="${esc(R.url)}" target="_blank" rel="noopener">${esc(R.url)}</a><br>
    ${plural(devs.length, 'capture')} across ${plural(nDevices, 'device')} and ${plural(platforms.length, 'platform')} · ${esc(started.toLocaleString())} · ${ms(R.timing.wallMs)} · ${esc(R.backend)} backend · devicepreview ${esc(R.tool.version)}</p></div>`;
  $('#stats').innerHTML = `
    <div class="stat ${s.errors ? 'err' : ''}"><b class="num">${s.errors}</b><span>errors</span></div>
    <div class="stat ${s.warnings ? 'warn' : ''}"><b class="num">${s.warnings}</b><span>warnings</span></div>
    <div class="stat"><b class="num">${s.infos}</b><span>info</span></div>
    <div class="stat ok"><b class="num">${s.devicesPassed}<small style="font-size:12px;color:var(--muted)">/${devs.length}</small></b><span>${unit}s passed</span></div>
    ${blocked ? `<div class="stat wall"><b class="num">${blocked}</b><span>blocked</span></div>` : ''}
    ${failed ? `<div class="stat wall"><b class="num">${failed}</b><span>failed</span></div>` : ''}`;
}

// ── toolbar ────────────────────────────────────────────────────────
const sevMatch = d => state.sev === 'all' || (state.sev === 'error' && d._c.error) || (state.sev === 'warn' && d._c.warn)
  || (state.sev === 'clean' && d.status === 'ok' && !d._c.error && !d._c.warn) || (state.sev === 'problem' && d.status !== 'ok');
const visible = () => devs.filter(d => sevMatch(d) && state.platforms.has(d.platform));
const renderBar = () => {
  const n = k => devs.filter(d => { const save = state.sev; state.sev = k; const m = sevMatch(d); state.sev = save; return m; }).length;
  const segs = [['all', 'All'], ['error', 'With errors'], ['warn', 'With warnings'], ['clean', 'Clean'], ['problem', 'Blocked / failed']]
    .filter(([k]) => k === 'all' || n(k)).map(([k, l]) => `<button type="button" data-sev="${k}" class="${state.sev === k ? 'on' : ''}" aria-pressed="${state.sev === k}">${l}<span class="n">${n(k)}</span></button>`).join('');
  const chips = platforms.map(p => `<button type="button" class="chip ${state.platforms.has(p) ? 'on' : ''}" data-plat="${esc(p)}" aria-pressed="${state.platforms.has(p)}">${esc(PLATFORM[p] || p)}<span class="n">${devs.filter(d => d.platform === p).length}</span></button>`).join('');
  $('#bar').innerHTML = `<div class="seg" role="group" aria-label="Filter by result">${segs}</div>
    ${platforms.length > 1 ? `<div class="chips" role="group" aria-label="Platforms">${chips}</div>` : ''}
    <div class="seg" role="group" aria-label="Order"><button type="button" data-sort="worst" class="${state.sort === 'worst' ? 'on' : ''}">Worst first</button><button type="button" data-sort="matrix" class="${state.sort === 'matrix' ? 'on' : ''}">Matrix order</button></div>
    <span class="grow"></span>
    <button type="button" class="btn primary" id="cmp" disabled>Compare selected (0/2)</button>
    <span class="hint">Tick two ${unit}s to compare them side by side.</span>`;
};
document.addEventListener('click', e => {
  const s = e.target.closest('[data-sev]'); if (s) { state.sev = s.dataset.sev; render(); return; }
  const p = e.target.closest('[data-plat]'); if (p) {
    if (state.platforms.has(p.dataset.plat) && state.platforms.size === 1) state.platforms = new Set(platforms);   // last one off = all back on
    else if (state.platforms.has(p.dataset.plat)) state.platforms.delete(p.dataset.plat); else state.platforms.add(p.dataset.plat);
    render(); return;
  }
  const o = e.target.closest('[data-sort]'); if (o) { state.sort = o.dataset.sort; render(); }
});

// ── cards ──────────────────────────────────────────────────────────
const badges = d => {
  const c = d._c;
  const main = d.status === 'blocked' ? '<span class="b fail">blocked — bot protection</span>'
    : d.status !== 'ok' ? '<span class="b fail">capture failed</span>'
    : (c.error || c.warn || c.info)
      ? (c.error ? `<span class="b err">${plural(c.error, 'error')}</span>` : '')
        + (c.warn ? `<span class="b warn">${plural(c.warn, 'warning')}</span>` : '')
        + (c.info ? `<span class="b info">${c.info} info</span>` : '')
      : '<span class="b ok">clean</span>';
  return main + (d.verified ? '' : '<span class="b unv" title="Viewport, scale factor and user agent come from published specs, not a physical device">unverified</span>');
};
const card = d => {
  const img = d.images.thumb || d.images.fold;
  const w = d._worst;
  return `<article class="card sev-${d._sev} ${state.picks.includes(d._key) ? 'selected' : ''}" data-key="${esc(d._key)}">
    <span class="stripe" aria-hidden="true"></span>
    <div class="head"><div><div class="name">${esc(d.label)}</div><div class="sub">${esc(ENGINE[d.engine] || d.engine)} · ${d.viewport.width}×${d.viewport.height} @${d.device_scale_factor}×${d._variant ? ' · ' + esc(d._variant) : ''}</div></div>
      <label class="pickw"><input type="checkbox" class="pick" ${state.picks.includes(d._key) ? 'checked' : ''} ${state.picks.length >= 2 && !state.picks.includes(d._key) ? 'disabled' : ''} aria-label="Select ${esc(d.label)} for compare">compare</label></div>
    <button type="button" class="open" aria-label="Open ${esc(d.label)}">
      <div class="frame ${d._shape}"><div class="screen" style="aspect-ratio:${d.viewport.width} / ${d.viewport.height}">${
        img ? `<img src="${esc(img)}" alt="${esc(d.label)}, above the fold">` : `<div class="nope">${esc(d.error || 'no capture')}</div>`}</div></div>
    </button>
    <div class="badges">${badges(d)}</div>
    ${d.status !== 'ok' ? `<p class="worst">${esc(d.error || '')}</p>`
      : w ? `<p class="worst" title="${esc(w.message)}"><span class="r">${esc(w.rule)}</span>${esc(w.message)}</p>` : ''}
  </article>`;
};
const render = () => {
  renderBar();
  const vis = visible().sort((a, b) => state.sort === 'worst' ? (b._s - a._s || a._i - b._i) : a._i - b._i);
  const groups = new Map();
  for (const d of vis) (groups.get(d.platform) || groups.set(d.platform, []).get(d.platform)).push(d);
  const ordered = [...groups.entries()].sort((a, b) => state.sort === 'worst' ? (b[1][0]._s - a[1][0]._s || a[1][0]._i - b[1][0]._i) : a[1][0]._i - b[1][0]._i);
  $('#groups').innerHTML = ordered.map(([p, ds]) => `<section class="group"><h2>${esc(PLATFORM[p] || p)}<span class="n">${ds.length}</span></h2><div class="cards">${ds.map(card).join('')}</div></section>`).join('');
  const empty = $('#empty'); empty.hidden = vis.length > 0;
  empty.textContent = devs.length ? 'No captures match these filters.' : 'This run captured nothing.';
  syncPicks();
};

// ── overlays (shared by detail and compare) ────────────────────────
// Boxes are in CSS pixels of the document; the image is CSS px × scale
// factor, so its natural size gives the exact mapping.
const drawBoxes = (wrap, img, d, fs) => {
  const place = () => {
    const W = img.naturalWidth / d.device_scale_factor, H = img.naturalHeight / d.device_scale_factor;
    if (!W || !H) return;
    $$('.box', wrap).forEach(b => b.remove());
    for (const f of fs) {
      const b = f.box;
      if (f.scope === 'page' || !b || !(b.width > 0) || !(b.height > 0) || b.x >= W || b.y >= H) continue;
      const el = document.createElement('div');
      el.className = 'box ' + (f.severity === 'error' ? 'err' : f.severity); el.dataset.f = f._i; el.title = f.rule + ': ' + f.message;
      el.style.cssText = `left:${b.x / W * 100}%;top:${b.y / H * 100}%;width:${Math.min(b.width, W - b.x) / W * 100}%;height:${Math.min(b.height, H - b.y) / H * 100}%`;
      wrap.appendChild(el);
    }
  };
  if (img.complete && img.naturalWidth) place(); else img.addEventListener('load', place, {once: true});
};
const indexed = d => (d.findings || []).map((f, i) => ({...f, _i: i})).sort((a, b) => (SEVN[a.severity] ?? 9) - (SEVN[b.severity] ?? 9) || a._i - b._i);

// ── detail dialog ──────────────────────────────────────────────────
const detail = $('#detail');
const dstate = {key: null, zoom: 'fit', overlays: true, sev: new Set(['error', 'warn', 'info']), opener: null};
const order = () => visible().sort((a, b) => state.sort === 'worst' ? (b._s - a._s || a._i - b._i) : a._i - b._i).map(d => d._key);
const closeDetail = () => { if (!detail.classList.contains('open')) return; detail.classList.remove('open'); detail.innerHTML = ''; document.body.style.overflow = '';
  if (dstate.opener && document.contains(dstate.opener)) dstate.opener.focus(); };
const zoomWidth = d => dstate.zoom === 'fit' ? '100%' : `${d.viewport.width * Number(dstate.zoom)}px`;
const openDetail = (key, opener) => {
  const d = byKey[key]; if (!d) return;
  dstate.key = key; if (opener) dstate.opener = opener;
  const fs = indexed(d), placed = fs.filter(f => f.scope !== 'page' && f.box && f.box.width > 0), pageLevel = fs.filter(f => !placed.includes(f));
  const full = d.images.full || d.images.fold;
  const keys = order(), at = keys.indexOf(key);
  const fitem = f => `<div class="f ${f.severity === 'error' ? 'err' : esc(f.severity)} ${dstate.sev.has(f.severity) ? '' : 'hide'}" data-f="${f._i}" tabindex="0">
      <div class="rule"><span class="sv" aria-hidden="true"></span>${esc(f.severity)} · ${esc(f.rule)}</div><div>${esc(f.message)}</div>${f.selector && f.scope !== 'page' ? `<code>${esc(f.selector)}</code>` : ''}</div>`;
  const c = d._c;
  const failedFonts = (d.fonts && d.fonts.failed_requests || []).length;
  detail.innerHTML = `<div class="panel">
    <header class="dhead">
      <button type="button" class="nav" data-step="-1" ${at <= 0 ? 'disabled' : ''} aria-label="Previous ${unit}" title="Previous (←)">‹</button>
      <div><h2 id="dtitle">${esc(d.label)}</h2><div class="meta">${esc(ENGINE[d.engine] || d.engine)} · ${d.viewport.width}×${d.viewport.height} @${d.device_scale_factor}×${d._variant ? ' · ' + esc(d._variant) : ''}${d.final_url && d.final_url !== d.url ? ' · landed on ' + esc(d.final_url) : ''} · ${at + 1} of ${keys.length}</div></div>
      <button type="button" class="nav" data-step="1" ${at >= keys.length - 1 ? 'disabled' : ''} aria-label="Next ${unit}" title="Next (→)">›</button>
      <div class="dtools">
        <div class="seg" role="group" aria-label="Zoom">${[['fit', 'Fit'], ['1', '100%'], ['2', '200%']].map(([z, l]) => `<button type="button" data-zoom="${z}" class="${dstate.zoom === z ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="tog"><input type="checkbox" id="ov" ${dstate.overlays ? 'checked' : ''}> Overlays</label>
        ${full ? `<a class="lnk" href="${esc(full)}" target="_blank" rel="noopener">Open image</a>` : ''}
        <button type="button" class="btn close">Close</button>
      </div>
    </header>
    <div class="dbody">
      <div class="shot"><div class="wrap ${dstate.overlays ? '' : 'noov'}" style="--zw:${zoomWidth(d)}">${
        full ? `<img id="dshot" src="${esc(full)}" alt="${esc(d.label)}, full page">` : `<div class="nope" style="min-height:200px">${esc(d.error || 'no capture')}</div>`}</div></div>
      <aside class="side">
        <div class="sevbar" role="group" aria-label="Show severities">${[['error', 'errors', c.error], ['warn', 'warnings', c.warn], ['info', 'info', c.info]].map(([k, l, n]) =>
          `<button type="button" class="chip ${dstate.sev.has(k) ? 'on' : ''}" data-dsev="${k}" aria-pressed="${dstate.sev.has(k)}" ${n ? '' : 'disabled'}>${l}<span class="n">${n}</span></button>`).join('')}</div>
        ${d.status === 'blocked' ? `<div class="state wall"><b>Blocked</b>${esc(d.error)}<br>What you see is the wall, kept as evidence. Nothing on it was audited and this ${unit} is not counted as passed. Try again later, or from a network the site trusts.</div>`
          : d.status !== 'ok' ? `<div class="state fail"><b>Capture failed</b>${esc(d.error)}<br>Retried once with double the timeout. Nothing here vouches for the page.</div>` : ''}
        ${d.status === 'ok' && !fs.length ? '<p class="note" style="margin-top:16px">Nothing flagged on this ' + unit + '. Look at the capture anyway — the rules catch geometry, not taste.</p>' : ''}
        ${placed.length ? `<h4>On the page<span class="n">${placed.length}</span></h4>${placed.map(fitem).join('')}` : ''}
        ${pageLevel.length ? `<h4>About the whole page<span class="n">${pageLevel.length}</span></h4>${pageLevel.map(fitem).join('')}` : ''}
        ${d.diff ? `<h4>Baseline diff</h4><p class="note">${Number(d.diff.percent ?? 0).toFixed(3)}% of pixels changed${d.diff.regressed ? ' — regressed' : ''}</p>${d.diff.image ? `<img class="diffimg" src="${esc(d.diff.image)}" alt="difference against the baseline">` : ''}` : ''}
        ${d.notes && d.notes.length ? `<h4>Notes</h4>${d.notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}` : ''}
        <h4>Capture</h4><div class="kv">
          ${d.page && d.page.title ? `<span>Title</span><b>${esc(d.page.title)}</b>` : ''}
          ${d.page && d.page.scrollHeight ? `<span>Page</span><b class="num">${d.page.scrollWidth}×${d.page.scrollHeight} css px</b>` : ''}
          ${d.page && d.page.cls != null ? `<span>Layout shift</span><b class="num">${Number(d.page.cls).toFixed(3)}</b>` : ''}
          ${d.fonts && d.fonts.faces ? `<span>Webfonts</span><b>${d.fonts.faces.filter(f => f.used).length} used${failedFonts ? `, ${failedFonts} failed request${failedFonts === 1 ? '' : 's'}` : ''}</b>` : ''}
          <span>Timings</span><b class="num">${Object.entries(d.timings_ms || {}).map(([k, v]) => `${esc(k)} ${ms(v)}`).join(' · ')}</b>
        </div>
      </aside>
    </div></div>`;
  detail.classList.add('open'); document.body.style.overflow = 'hidden';
  const img = $('#dshot', detail); if (img) drawBoxes($('.wrap', detail), img, d, fs);
  $('.close', detail).focus();
};
// One delegated listener for the dialog's lifetime — never re-registered per open.
const hot = (i, on) => $$(`[data-f="${i}"]`, detail).forEach(el => el.classList.toggle('hot', on));
detail.addEventListener('mouseover', e => { const t = e.target.closest('[data-f]'); if (t) hot(t.dataset.f, true); });
detail.addEventListener('mouseout', e => { const t = e.target.closest('[data-f]'); if (t) hot(t.dataset.f, false); });
detail.addEventListener('change', e => {
  if (e.target.id === 'ov') { dstate.overlays = e.target.checked; $('.wrap', detail).classList.toggle('noov', !dstate.overlays); }
});
detail.addEventListener('click', e => {
  if (e.target === detail || e.target.closest('.close')) return closeDetail();
  const z = e.target.closest('[data-zoom]'); if (z) { dstate.zoom = z.dataset.zoom; const d = byKey[dstate.key]; $('.wrap', detail).style.setProperty('--zw', zoomWidth(d)); $$('[data-zoom]', detail).forEach(b => b.classList.toggle('on', b === z)); return; }
  const st = e.target.closest('[data-step]'); if (st && !st.disabled) { const keys = order(), at = keys.indexOf(dstate.key) + Number(st.dataset.step); if (keys[at]) openDetail(keys[at]); return; }
  const sv = e.target.closest('[data-dsev]'); if (sv) { const k = sv.dataset.dsev; dstate.sev.has(k) ? dstate.sev.delete(k) : dstate.sev.add(k); sv.classList.toggle('on'); sv.setAttribute('aria-pressed', dstate.sev.has(k));
    $$('.f', detail).forEach(f => f.classList.toggle('hide', !dstate.sev.has(f.classList.contains('err') ? 'error' : f.classList.contains('warn') ? 'warn' : 'info')));
    $$('.box', detail).forEach(b => b.classList.toggle('dim', !dstate.sev.has(b.classList.contains('err') ? 'error' : b.classList.contains('warn') ? 'warn' : 'info'))); return; }
  const t = e.target.closest('[data-f]'); if (!t) return;
  const other = t.classList.contains('box') ? $(`.f[data-f="${t.dataset.f}"]`, detail) : $(`.box[data-f="${t.dataset.f}"]`, detail);
  if (other) { other.scrollIntoView({block: 'center', behavior: 'smooth'}); hot(t.dataset.f, true); setTimeout(() => hot(t.dataset.f, false), 1200); }
});
document.addEventListener('keydown', e => {
  if (!detail.classList.contains('open')) return;
  if (e.key === 'Escape') closeDetail();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const keys = order(), at = keys.indexOf(dstate.key) + (e.key === 'ArrowRight' ? 1 : -1); if (keys[at]) openDetail(keys[at]); }
});

// ── card interactions ──────────────────────────────────────────────
document.addEventListener('click', e => { const o = e.target.closest('.card .open'); if (o) openDetail(o.closest('.card').dataset.key, o); });
document.addEventListener('change', e => {
  if (!e.target.classList.contains('pick')) return;
  const key = e.target.closest('.card').dataset.key;
  state.picks = e.target.checked ? [...state.picks.filter(k => k !== key), key].slice(-2) : state.picks.filter(k => k !== key);
  syncPicks(); if ($('#compare').classList.contains('open') && state.picks.length === 2) openCompare();
});
const syncPicks = () => {
  const n = state.picks.length, btn = $('#cmp');
  if (btn) { btn.disabled = n !== 2; btn.textContent = `Compare selected (${n}/2)`; }
  $$('.card').forEach(c => { const on = state.picks.includes(c.dataset.key); c.classList.toggle('selected', on); const p = $('.pick', c); p.checked = on; p.disabled = n >= 2 && !on; });
};

// ── compare ────────────────────────────────────────────────────────
const cmp = $('#compare');
const cstate = {overlays: false};
const openCompare = () => {
  const [a, b] = state.picks.map(k => byKey[k]); if (!a || !b) return;
  const opts = sel => devs.map(d => `<option value="${esc(d._key)}" ${d._key === sel ? 'selected' : ''}>${esc(d.label)}${d._variant ? ' · ' + esc(d._variant) : ''}</option>`).join('');
  const pane = (d, side) => `<div class="pane" data-side="${side}"><div class="ph"><span>${esc(d.label)} <span class="meta">· ${esc(ENGINE[d.engine] || d.engine)} · ${d.viewport.width}×${d.viewport.height}${d._variant ? ' · ' + esc(d._variant) : ''}</span></span><span class="meta">${d.status === 'ok' ? plural(d._c.error, 'error') + ', ' + plural(d._c.warn, 'warning') : esc(d.status)}</span></div>
    <div class="pb"><div class="wrap ${cstate.overlays ? '' : 'noov'}" style="--zw:${d.viewport.width}px">${d.images.full ? `<img src="${esc(d.images.full)}" alt="${esc(d.label)}, full page">` : `<div class="nope" style="min-height:160px">${esc(d.error || 'no capture')}</div>`}</div></div></div>`;
  cmp.innerHTML = `<div class="ch"><strong>Side by side</strong>
      <select id="cmpA" aria-label="Left device">${opts(a._key)}</select><button type="button" class="btn" id="swap" title="Swap sides" aria-label="Swap sides">⇄</button><select id="cmpB" aria-label="Right device">${opts(b._key)}</select>
      <label class="tog"><input type="checkbox" id="cmpov" ${cstate.overlays ? 'checked' : ''}> Overlays</label>
      <span class="hint">Scrolling one pane scrolls the other proportionally.</span><span class="grow"></span><button type="button" class="btn" id="cmpclose">Close compare</button></div>${pane(a, 'a')}${pane(b, 'b')}`;
  cmp.classList.add('open');
  for (const [d, side] of [[a, 'a'], [b, 'b']]) { const wrap = $(`.pane[data-side="${side}"] .wrap`, cmp), img = $('img', wrap); if (img) drawBoxes(wrap, img, d, indexed(d)); }
  const [pa, pb] = $$('.pb', cmp); let lock = false;
  const link = (from, to) => from.addEventListener('scroll', () => { if (lock) return; lock = true;
    to.scrollTop = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight) * (to.scrollHeight - to.clientHeight); requestAnimationFrame(() => { lock = false; }); });
  link(pa, pb); link(pb, pa);
};
cmp.addEventListener('change', e => {
  if (e.target.id === 'cmpov') { cstate.overlays = e.target.checked; $$('.wrap', cmp).forEach(w => w.classList.toggle('noov', !cstate.overlays)); return; }
  if (e.target.id === 'cmpA' || e.target.id === 'cmpB') { const A = $('#cmpA').value, B = $('#cmpB').value; state.picks = A === B ? [A] : [A, B]; syncPicks(); if (state.picks.length === 2) openCompare(); }
});
cmp.addEventListener('click', e => {
  if (e.target.closest('#cmpclose')) { cmp.classList.remove('open'); cmp.innerHTML = ''; return; }
  if (e.target.closest('#swap')) { state.picks.reverse(); openCompare(); }
});
document.addEventListener('click', e => { if (e.target.closest('#cmp') && state.picks.length === 2) { openCompare(); cmp.scrollIntoView({behavior: 'smooth', block: 'start'}); } });

// ── footer ─────────────────────────────────────────────────────────
{
  const names = [...new Set(devs.filter(d => !d.verified).map(d => d.label))];
  const off = Object.entries(R.rules || {}).filter(([, v]) => !v).map(([k]) => k);
  $('#foot').innerHTML = `<p>${names.length
      ? `<b>Unverified profiles (${names.length}):</b> ${esc(names.join(', '))}. Their viewport, scale factor and user agent come from published specifications and have not been checked against the physical device.`
      : '<b>Profiles:</b> every profile in this run has been verified against a physical device.'}</p>
    <p><b>Rendering fidelity:</b> ${esc(R.fidelityNote)}</p>
    <p><b>This run:</b> report.json schema v${esc(R.schemaVersion)} · ${plural(devs.length, 'capture')} · rules switched off: ${off.length ? esc(off.join(', ')) : 'none'} · <a href="report.json">report.json</a></p>`;
}

render();
})();
</script>
</body>
</html>
"""


def write_report_html(report: dict[str, Any], out_dir: Path) -> Path:
    """One file, no network. CSS and JS are inline, the report is embedded as
    JSON, and images are referenced relative to the run directory, so the
    folder can be zipped and opened anywhere. Every '<' in the embedded JSON is
    escaped as \\u003c (still valid JSON), so no string a page handed us —
    a title, a selector, a font name — can close the script element early."""
    data = json.dumps(report, separators=(",", ":")).replace("<", "\\u003c")
    page = REPORT_HTML.replace("__TITLE__", html_escape(report["url"])).replace("__DATA__", data)
    path = out_dir / "report.html"
    path.write_text(page, encoding="utf-8")
    return path


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
        "tool": {"name": "devicepreview", "version": TOOL_VERSION, "step": 5},
        "files": {"json": "report.json", "html": "report.html"},
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
    write_report_html(report, out_dir)

    failed = [r for r in results if r.status != "ok"]
    blocked = [r for r in results if r.status == "blocked"]
    summary = report["summary"]
    if args.json:
        print(out_dir / "report.json")
    else:
        say(f"\n  {len(results)} capture(s), {len(failed) - len(blocked)} failed, {len(blocked)} blocked, "
            f"{summary['errors']} error(s), {summary['warnings']} warning(s), "
            f"{timing['wallMs'] / 1000:.1f}s wall → {out_dir}/report.json")
        say(f"  gallery: {out_dir}/report.html")
        for r in blocked:
            say(f"    {r.label:26} BLOCKED        {(r.error or '')[:90]}")
        for r in results:
            for f in r.findings:
                if f["severity"] == "error":
                    say(f"    {r.label:26} {f['rule']:14} {f['message'][:90]}")
    # 0 clean, 1 any error-severity finding, 2 tool failure. Failure wins: a
    # run that could not capture cannot vouch for anything.
    return 2 if failed else (1 if summary["errors"] else 0)


if __name__ == "__main__":
    sys.exit(main())
