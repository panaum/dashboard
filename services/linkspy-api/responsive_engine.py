"""Responsive sweep — the deployed copy.

SOURCE OF TRUTH: services/pagecheck/pagecheck.py. This copy is what Railway
deploys and what the Deliverables dashboard calls; keep the detection logic
identical to the CLI or the two will drift and disagree about the same page.

Loads a page at eight widths and reports what breaks: sideways scroll, text
clipped by a hidden overflow, text physically colliding with text, and where
the primary call to action sits relative to the fold. Five of the eight widths
sit in the small-mobile band, because that is where hand-checking finds bugs.

Chromium only. The CLI also renders in Firefox and WebKit; adding those here
means adding them to the Dockerfile, which roughly doubles the image.

Read-only. It never submits a form, and every analytics collector is aborted
at the route level on all eight loads.
"""
from __future__ import annotations

import re
import time
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from playwright.sync_api import Error as PWError, TimeoutError as PWTimeout, sync_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36 Pagecheck/0.1 (+https://apexure.com; read-only QA)")

TEST_PARAMS = {"utm_source": "qa", "utm_medium": "qa", "utm_campaign": "qa", "utm_term": "qa",
               "utm_content": "qa", "gclid": "QA_TEST_GCLID", "fbclid": "QA_TEST_FBCLID"}

COLLECTORS = ("google-analytics.com", "analytics.google.com", "/g/collect", "/j/collect",
              "googletagmanager.com/gtag", "/gtag/js", "facebook.com/tr", "doubleclick.net/",
              "googleads.g.doubleclick.net", "google.com/ads/ga-audiences", "/ccm/collect",
              "/ccm/s/collect", "bat.bing.com", "px.ads.linkedin.com", "analytics.tiktok.com",
              "ct.pinterest.com", "t.co/i/adsct", "clarity.ms/collect", "hotjar.com",
              "mixpanel.com/track", "api.segment.io", "track.hubspot.com", "hs-analytics.net",
              "plausible.io/api/event", "matomo.php", "piwik.php")
COLLECTOR_RX = re.compile("|".join(re.escape(p) for p in COLLECTORS))

WIDTHS = ((350, 750), (375, 812), (425, 900), (450, 900), (470, 900),
          (768, 1024), (1024, 768), (1440, 900))
WIDTH_LIST = [w for w, _ in WIDTHS]


def F(fid, status, title, detail="", evidence=None):
    return {"id": fid, "status": status, "title": title, "detail": detail,
            "evidence": evidence or []}


def with_params(url: str) -> str:
    p = urlsplit(url if "://" in url else "https://" + url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q.update(TEST_PARAMS)
    return urlunsplit((p.scheme, p.netloc, p.path or "/", urlencode(q), p.fragment))


def _eval(frame, js, default, arg=None):
    try:
        return frame.evaluate(js, arg)
    except (PWError, PWTimeout):
        return default


RESPONSIVE_JS = """(vw) => {
  const TOL = 2;
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const sel = (el) => {
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) {
      cls = '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    return (el.tagName.toLowerCase() + id + cls).slice(0, 70);
  };
  const ownText = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    return false;
  };
  const anyText = (el) => (el.innerText || '').trim().length > 1;
  // Rendered glyph boxes, not element boxes. Two elements whose boxes intersect
  // are routine — a negative margin does it — and reporting those produced a
  // false positive on a testimonial that renders perfectly. Text physically
  // colliding with text is the only version of this worth a human's time.
  const textRects = (el) => {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, budget = 250;
    while ((n = w.nextNode()) && budget-- > 0) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push(r);
    }
    return out;
  };
  const glyphHit = (A, B) => {
    for (const a of A) for (const b of B) {
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1 && ox * oy >= 24) return Math.round(ox * oy);
    }
    return 0;
  };
  const snippet = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  // An element sticking out inside a container that clips or scrolls does not
  // break the page. Only unclipped overflow can move the document.
  const clipped = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/hidden|clip|auto|scroll/.test(s.overflowX)) return true;
      n = n.parentElement;
    }
    return false;
  };
  // Only auto/scroll — a strip the visitor can scroll sideways is meant to
  // extend past the edge. Deliberately NOT hidden/clip: content clipped at the
  // viewport edge is the bug the edge check exists to find.
  const scrollableAnc = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      if (/auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      n = n.parentElement;
    }
    return false;
  };

  const SLIDERS = '[class*="splide"],[class*="swiper"],[class*="slick"],[class*="carousel"],'
    + '[class*="slider"],[class*="glide"],[class*="flickity"],[class*="marquee"],'
    + '[class*="ticker"],[class*="track"],[id*="track"],[class*="loop"]';
  const doc = document.documentElement;
  // A bot challenge renders a perfectly tidy page. Measuring it and reporting
  // PASS is the worst outcome available: a silent all-clear on a page nobody
  // actually saw. Cloudflare rate-limited a run and this went unnoticed.
  const t = (document.title || '').toLowerCase();
  const hit = document.querySelector('.cf-error-overview, #challenge-running, #challenge-form');
  const titleHit = /just a moment|attention required|you have been blocked|access denied|verify you are human/.test(t);
  if (hit || titleHit) {
    return { challenged: true,
             challengedWhy: hit ? ('matched ' + (hit.className || hit.id)) : ('title: ' + t.slice(0, 60)),
             docOverflow: 0, culprits: [], cut: [], edge: [], overlaps: [], cta: null };
  }

  const docOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  const all = [...document.querySelectorAll('body *')];

  // 1 · horizontal overflow. Gated on the document actually scrolling sideways:
  // without that gate every decorative element bleeding off a clipped hero
  // would be reported as a break.
  const culprits = [];
  if (docOverflow >= 3) {
    for (const el of all) {
      if (!vis(el)) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + TOL) continue;
      if (clipped(el)) continue;
      // Report where the excess is introduced, not every descendant of it.
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > vw + TOL) continue;
      culprits.push({ sel: sel(el), right: Math.round(r.right), width: Math.round(r.width),
                      over: Math.round(r.right - vw), text: snippet(el) });
      if (culprits.length >= 8) break;
    }
  }

  // 1b · content cut off at the viewport edge.
  //
  // The overflow check above is gated on the document actually scrolling
  // sideways, which is right for a decorative background bleeding out of a
  // clipped hero — but it also hid a real bug: a photo 35px past a 1024px
  // viewport, clipped so the page never scrolled, reported as a clean pass.
  // Content is the distinction. Only images and text-bearing elements count,
  // only when part of them is still on screen (an off-canvas menu is
  // deliberate), and sliders are excluded because their track is meant to sit
  // outside the frame.
  const edge = [];
  for (const el of all) {
    if (!vis(el)) continue;
    const st = getComputedStyle(el);
    if (st.position === 'fixed') continue;
    const isImg = el.tagName === 'IMG' || el.tagName === 'PICTURE';
    if (!isImg && !ownText(el)) continue;
    if (el.closest(SLIDERS)) continue;
    const r = el.getBoundingClientRect();
    const cutR = Math.round(r.right - vw);
    const cutL = Math.round(-r.left);
    const cut = Math.max(cutR, cutL);
    if (cut < 8) continue;
    if (r.right <= 0 || r.left >= vw) continue;          // wholly off screen
    // A horizontally SCROLLABLE strip is meant to extend past the edge — a
    // filter bar of trades reported every off-screen chip as cut content. Only
    // auto/scroll qualifies: an ancestor with overflow:hidden is exactly the
    // case this check exists for (a photo clipped at the viewport edge), so
    // reusing clipped() here silently undid that.
    if (scrollableAnc(el)) continue;
    const frac = Math.round((cut / Math.max(1, r.width)) * 100);
    // Barely-visible slivers are off-canvas by design (carousel neighbours,
    // decorative art), not content someone is losing.
    if (frac >= 90) continue;
    edge.push({ sel: sel(el), tag: el.tagName, cut, frac,
                side: cutR >= cutL ? 'right' : 'left', text: snippet(el) });
    if (edge.length >= 8) break;
  }

  // 2 · clipped or truncated text. Ellipsis and line-clamp are deliberate, so
  // they are not findings.
  const cut = [];
  for (const el of all) {
    if (!vis(el) || !ownText(el)) continue;
    const s = getComputedStyle(el);
    const hidX = /hidden|clip/.test(s.overflowX);
    const hidY = /hidden|clip/.test(s.overflowY);
    if (!hidX && !hidY) continue;
    if (s.textOverflow === 'ellipsis') continue;
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') continue;
    // A box with no visible area is not clipping text, it is hiding it on
    // purpose: collapsed accordions (clientHeight 0) and screen-reader-only
    // links (clientWidth 1) both landed here and both were false positives.
    if (el.clientWidth < 8 || el.clientHeight < 8) continue;
    if (el.closest('[aria-expanded="false"], [aria-hidden="true"], [hidden]')) continue;
    const dx = el.scrollWidth - el.clientWidth;
    const dy = el.scrollHeight - el.clientHeight;
    // The element's scroll box overflowing is not the same as text being cut.
    // A CTA with a pulsing glow reported 236px of hidden overflow mid-animation
    // while its label "SCHEDULE CALL" sat perfectly inside the button. Ask the
    // question the check is named for: do the rendered glyphs leave the box?
    const box = el.getBoundingClientRect();
    let outR = 0, outB = 0;
    for (const tr of textRects(el)) {
      outR = Math.max(outR, tr.right - box.right);
      outB = Math.max(outB, tr.bottom - box.bottom);
    }
    if (outR < 2 && outB < 2) continue;
    if ((hidX && dx >= 4) || (hidY && dy >= 4)) {
      cut.push({ sel: sel(el), dx: Math.max(0, dx), dy: Math.max(0, dy), text: snippet(el) });
      if (cut.length >= 8) break;
    }
  }

  // 3 · overlapping siblings involving text. Positioned elements are excluded:
  // badges, sticky headers and dropdowns overlap on purpose.
  const overlaps = [];
  const parents = new Set();
  for (const el of all) if (el.children.length > 1) parents.add(el);
  outer:
  for (const p of parents) {
    const kids = [...p.children].filter((k) => {
      if (!vis(k)) return false;
      const s = getComputedStyle(k);
      return s.position === 'static' || s.position === 'relative';
    });
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i], b = kids[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (!anyText(a) || !anyText(b)) continue;
        // Cheap box prefilter first; the glyph test below is the expensive part.
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox <= 2 || oy <= 2) continue;
        const hit = glyphHit(textRects(a), textRects(b));
        if (!hit) continue;
        overlaps.push({ a: sel(a), b: sel(b), area: hit,
                        pct: Math.round((hit / Math.max(1, Math.min(ra.width * ra.height,
                                                                    rb.width * rb.height))) * 100),
                        text: snippet(a) });
        if (overlaps.length >= 6) break outer;
      }
    }
  }

  // 4 · the most prominent call to action. Reported, never judged.
  const CTA = /\\b(get|start|book|buy|call|contact|request|apply|sign ?up|subscribe|download|quote|demo|free|try|order|schedule|enquire|inquire|join|shop|claim|reserve)\\b/i;
  // On a page with a lead form, submitting that form IS the conversion. A link
  // labelled "GET A FAST QUOTE" only scrolls you to the form, so it must not
  // outrank the form's own control — which is what happened here: the CTA
  // vocabulary bonus let a below-fold link beat a NEXT button sitting in view.
  // Rewarding visibility directly would make the check circular, so the rule is
  // about what the control DOES, not where it sits.
  let best = null, bestInForm = null;
  for (const el of document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button]')) {
    if (!vis(el)) continue;
    const t = ((el.innerText || el.value || '') + '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length > 40) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 400) continue;
    // A footer newsletter box is always below the fold, so letting it win made
    // the whole check vacuous — it beat the hero CTA on a contact page.
    if (el.closest('footer, [class*="footer" i], [id*="footer" i]')) continue;
    // One of many identical siblings is a list or a nav, not THE call to
    // action. A lesson-list item won on a course page purely by being large and
    // near the top. A hero CTA is singular; excluding repeats keeps the header
    // CTA that legitimately sits in a nav bar.
    // A repeated item inside a list or nav is navigation, not THE call to
    // action. Both conditions are required. Counting same-tag siblings alone
    // was too blunt: an Unbounce mobile layout puts every anchor under one flat
    // root, so seven unrelated siblings excluded every real CTA on the page and
    // left an email address in the footer as the only survivor.
    const par = el.parentElement;
    if (par && el.closest('nav,ul,ol,[role="list"],[role="navigation"],[role="menu"],[role="tablist"]')) {
      let twins = 0;
      for (const sib of par.children) if (sib !== el && sib.tagName === el.tagName) twins++;
      if (twins >= 3) continue;
    }
    const s = getComputedStyle(el);
    const filled = !/^rgba?\\(0, 0, 0, 0\\)$|transparent/.test(s.backgroundColor || '');
    const top = Math.round(r.top + window.scrollY);
    // Prominence decays down the page: the thing a visitor is meant to do sits
    // near the top, not 2000px into the tail.
    const posW = 1 / (1 + (Math.max(0, top) / Math.max(1, doc.scrollHeight)) * 4);
    const score = area * (CTA.test(t) ? 2.5 : 1) * (filled ? 1.5 : 1) * posW;
    const cand = { score: Math.round(score), sel: sel(el), text: t.slice(0, 40),
                   top: top, height: Math.round(r.height), inForm: !!el.closest('form') };
    if (!best || cand.score > best.score) best = cand;
    if (cand.inForm && (!bestInForm || cand.score > bestInForm.score)) bestInForm = cand;
  }

  return { challenged: false, docOverflow, docWidth: doc.scrollWidth,
           pageHeight: doc.scrollHeight, culprits, cut, edge, overlaps,
           cta: bestInForm || best };
}"""


def _keys(d: dict | None) -> frozenset:
    """What a reading claims, ignoring exact pixel counts."""
    if not d:
        return frozenset()
    # Measurements are part of the identity, bucketed so ordinary jitter still
    # matches. An element whose numbers swing between readings is animating,
    # and an animation is not a layout bug.
    b = lambda n: round((n or 0) / 16)
    return frozenset(
        [("e", c["sel"], b(c.get("cut"))) for c in d.get("edge") or []]
        + [("o", c["sel"], b(c.get("over"))) for c in d.get("culprits") or []]
        + [("c", c["sel"], b(c.get("dx")), b(c.get("dy"))) for c in d.get("cut") or []]
        + [("v", o["a"], o["b"]) for o in d.get("overlaps") or []]
        + [("cta", (d.get("cta") or {}).get("sel", ""))])


def _settle(d1: dict | None, d2: dict | None) -> dict | None:
    """Keep only what two readings agree on.

    A third-party widget still laying itself out reports nonsense: a GoHighLevel
    submit button measured 545px of hidden overflow mid-render and exactly zero
    once settled — and while it was still rendering it was not yet a candidate
    for the primary CTA either, so a mid-page button won instead. Anything that
    appears in only one of two passes is dropped."""
    if not d1 or not d2:
        return d2 or d1
    b = lambda n: round((n or 0) / 16)
    out = dict(d2)
    for key, ident in (("edge", lambda x: (x["sel"], b(x.get("cut")))),
                       ("culprits", lambda x: (x["sel"], b(x.get("over")))),
                       ("cut", lambda x: (x["sel"], b(x.get("dx")), b(x.get("dy")))),
                       ("overlaps", lambda x: (x["a"], x["b"]))):
        seen = {ident(x) for x in (d1.get(key) or [])}
        out[key] = [x for x in (d2.get(key) or []) if ident(x) in seen]
    out["docOverflow"] = min(d1.get("docOverflow", 0), d2.get("docOverflow", 0))
    return out


def _ranges(widths: list[int]) -> str:
    """"350–470" rather than five near-identical rows. Five of the eight widths
    sit within 120px of each other, so almost every real finding repeats across
    all of them; printing each one separately makes a report nobody reads."""
    idx = sorted(WIDTH_LIST.index(w) for w in set(widths))
    groups: list[list[int]] = []
    for i in idx:
        if groups and i == groups[-1][-1] + 1:
            groups[-1].append(i)
        else:
            groups.append([i])
    return ", ".join(str(WIDTH_LIST[g[0]]) if len(g) == 1
                     else f"{WIDTH_LIST[g[0]]}–{WIDTH_LIST[g[-1]]}" for g in groups)

def responsive_findings(r: dict) -> list[dict]:
    """Collapse per-width results into one finding per distinct problem."""
    F_ = F
    out: list[dict] = []
    if r.get("errors"):
        out.append(F_("responsive-load", "SKIP", "Responsive sweep",
                      f"{len(r['errors'])} width(s) could not be measured.", r["errors"][:5]))
    if not r.get("widths"):
        return out

    blocked_w = [wd["width"] for wd in r["widths"] if wd.get("challenged")]
    if blocked_w:
        why = sorted({wd.get("challengedWhy", "") for wd in r["widths"] if wd.get("challenged")})
        out.append(F_("blocked", "SKIP", "Blocked at some widths",
                      f"A bot challenge was served at {_ranges(blocked_w)}, so those widths "
                      "measured nothing real. Re-run, more slowly, before trusting this page.",
                      [w for w in why if w][:3]))
    # Everything below reads only the widths that actually rendered the page.
    r = {**r, "widths": [wd for wd in r["widths"] if not wd.get("challenged")]}
    if not r["widths"]:
        return out

    # 1 · overflow, keyed by culprit element
    by_el: dict[str, dict] = {}
    for wd in r["widths"]:
        for c in wd.get("culprits", []):
            e = by_el.setdefault(c["sel"], {"widths": [], "over": 0, "text": c.get("text", "")})
            e["widths"].append(wd["width"])
            e["over"] = max(e["over"], c.get("over", 0))
    worst_doc = max((wd.get("docOverflow", 0) for wd in r["widths"]), default=0)
    if by_el:
        # A couple of pixels is rounding, not a broken layout.
        sev = "FAIL" if worst_doc >= 12 else "WARN"
        ev = [f"{_ranges(e['widths']):18} {s:44} +{e['over']}px  {e['text'][:32]!r}"
              for s, e in sorted(by_el.items(), key=lambda kv: -kv[1]["over"])[:8]]
        hit = sorted({w for e in by_el.values() for w in e["widths"]})
        out.append(F_("overflow", sev, "Horizontal overflow",
                      f"The page scrolls sideways at {_ranges(hit)} — worst excess "
                      f"{worst_doc}px past the viewport.", ev))
    else:
        out.append(F_("overflow", "PASS", "Horizontal overflow",
                      "No sideways scroll at any of the eight widths."))

    # 1b · content cut at the viewport edge
    by_edge: dict[str, dict] = {}
    for wd in r["widths"]:
        for e in wd.get("edge", []):
            g = by_edge.setdefault(e["sel"], {"widths": [], "cut": 0, "frac": 0,
                                              "tag": e.get("tag", ""), "text": e.get("text", "")})
            g["widths"].append(wd["width"])
            g["cut"], g["frac"] = max(g["cut"], e["cut"]), max(g["frac"], e.get("frac", 0))
    if by_edge:
        ev = [f"{_ranges(g['widths']):18} {s_:40} {g['cut']}px cut ({g['frac']}% of it)  {g['text'][:26]!r}"
              for s_, g in sorted(by_edge.items(), key=lambda kv: -kv[1]["cut"])[:8]]
        out.append(F_("edge", "WARN", "Content cut off at the edge",
                      f"{len(by_edge)} image(s) or text block(s) run past the viewport and are "
                      "clipped. Some bleed is deliberate — check the screenshots.", ev))
    else:
        out.append(F_("edge", "PASS", "Content cut off at the edge",
                      "Nothing runs past the viewport edge."))

    # 2 · clipped text — ambiguous by nature, so it never escalates past WARN
    by_cut: dict[str, dict] = {}
    for wd in r["widths"]:
        for c in wd.get("cut", []):
            e = by_cut.setdefault(c["sel"], {"widths": [], "dx": 0, "dy": 0, "text": c.get("text", "")})
            e["widths"].append(wd["width"])
            e["dx"], e["dy"] = max(e["dx"], c["dx"]), max(e["dy"], c["dy"])
    if by_cut:
        ev = [f"{_ranges(e['widths']):18} {s:44} cut {e['dx']}x{e['dy']}px  {e['text'][:30]!r}"
              for s, e in list(by_cut.items())[:8]]
        out.append(F_("clipped", "WARN", "Clipped text",
                      f"{len(by_cut)} element(s) hide part of their text behind "
                      "overflow:hidden. Check the screenshots — some clipping is deliberate.", ev))
    else:
        out.append(F_("clipped", "PASS", "Clipped text", "No text clipped by a hidden overflow."))

    # 3 · overlapping text
    by_ov: dict[tuple[str, str], dict] = {}
    for wd in r["widths"]:
        for o in wd.get("overlaps", []):
            k = (o["a"], o["b"])
            e = by_ov.setdefault(k, {"widths": [], "pct": 0, "text": o.get("text", "")})
            e["widths"].append(wd["width"])
            e["pct"] = max(e["pct"], o["pct"])
    if by_ov:
        ev = [f"{_ranges(e['widths']):18} {a} over {b}  {e['pct']}%  {e['text'][:28]!r}"
              for (a, b), e in sorted(by_ov.items(), key=lambda kv: -kv[1]["pct"])[:6]]
        out.append(F_("overlap", "WARN", "Overlapping text",
                      f"{len(by_ov)} pair(s) of siblings overlap where one carries text. "
                      "Confirm against the screenshots before reporting.", ev))
    else:
        out.append(F_("overlap", "PASS", "Overlapping text", "No text-bearing siblings overlap."))

    # 4 · CTA position — measured, not judged
    rows, below = [], []
    for wd in r["widths"]:
        cta = wd.get("cta")
        if not cta:
            continue
        fold = cta["top"] >= wd["height"]
        rows.append(f"{wd['width']:>5}px x {wd['height']:>4}   top {cta['top']:>5}px"
                    f"   {'below fold' if fold else 'in view  '}   {cta['text'][:22]!r}"
                    f"  {cta.get('sel', '')[:34]}")
        if fold:
            below.append(wd["width"])
    if rows:
        seen_w = [wd["width"] for wd in r["widths"] if wd.get("cta")]
        visible = [w for w in seen_w if w not in below]
        # Whether someone sees the call to action without scrolling is the point
        # of measuring its position, so the finding leads with that answer
        # rather than making the reader derive it from a table of pixels.
        if below:
            detail = (f"Not visible until you scroll at {_ranges(below)}."
                      + (f" Visible without scrolling at {_ranges(visible)}." if visible
                         else " It is below the fold at every width."))
        else:
            detail = "Visible without scrolling at every width."
        out.append(F_("cta", "WARN" if below else "PASS", "Is the CTA visible before scrolling?",
                      detail, rows))

    if r.get("shots"):
        out.append(F_("shots", "INFO", "Screenshots",
                      f"{len(r['shots'])} full-page screenshots — these are the deliverable.",
                      [f"{s['width']:>5}px  {s['path']}" for s in r["shots"]]))
    return out


def run_responsive(url: str, on_progress=None) -> tuple[dict, dict]:
    """Sweep the eight widths. Returns (report, shots) where shots maps a width
    to JPEG bytes — kept out of the report so the JSON stays small enough to
    travel through the dashboard proxy."""
    started = time.time()
    say = on_progress or (lambda _m: None)
    out = {"widths": [], "errors": [], "hits": [], "blocked": 0, "final_url": None}
    shots: dict[int, bytes] = {}
    target = with_params(url)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
        try:
            for idx, (w, h) in enumerate(WIDTHS):
                say(f"Rendering at {w}px ({idx + 1} of {len(WIDTHS)})…")
                t0 = time.time()
                # A fresh context per width: it arms the collector route on every
                # one of the eight loads, and stops a consent choice made at
                # 350px changing what is measured at 1440.
                ctx = browser.new_context(user_agent=UA, viewport={"width": w, "height": h},
                                          device_scale_factor=1, locale="en-AU")
                ctx.set_default_timeout(20000)
                blocked: list[str] = []
                ctx.route(COLLECTOR_RX,
                          lambda rt, req, b=blocked: (b.append(req.url), rt.abort()))
                page = ctx.new_page()
                page.on("requestfinished",
                        lambda rq: out["hits"].append(rq.url[:200])
                        if COLLECTOR_RX.search(rq.url) else None)
                try:
                    page.goto(target, wait_until="domcontentloaded", timeout=35000)
                    try:
                        page.wait_for_load_state("networkidle", timeout=10000)
                    except PWTimeout:
                        pass
                    if out["final_url"] is None:
                        out["final_url"] = page.url
                    page.wait_for_timeout(1200)
                    prev = _eval(page.main_frame, RESPONSIVE_JS, None, w)
                    cur = prev
                    for _ in range(4):
                        page.wait_for_timeout(700)
                        cur = _eval(page.main_frame, RESPONSIVE_JS, None, w)
                        if _keys(cur) == _keys(prev):
                            break
                        prev = cur
                    data = _settle(prev, cur)
                    try:
                        # Viewport WIDTH, full height. A plain full-page capture
                        # widens to the scrollWidth, which hid a 190px overflow
                        # by showing content the visitor cannot reach.
                        ph = int((data or {}).get("pageHeight") or 0)
                        shots[w] = (page.screenshot(full_page=True, type="jpeg", quality=72,
                                                    clip={"x": 0, "y": 0, "width": w,
                                                          "height": min(ph, 30000)})
                                    if ph > 0 else
                                    page.screenshot(full_page=True, type="jpeg", quality=72))
                    except PWError as exc:
                        out["errors"].append(f"{w}px screenshot: {str(exc)[:120]}")
                    if data:
                        data.update({"width": w, "height": h,
                                     "elapsed": round(time.time() - t0, 1)})
                        out["widths"].append(data)
                    out["blocked"] += len(blocked)
                except (PWError, PWTimeout) as exc:
                    out["errors"].append(f"{w}px: {type(exc).__name__}: {str(exc)[:140]}")
                finally:
                    try:
                        ctx.close()
                    except PWError:
                        pass
        finally:
            try:
                browser.close()
            except PWError:
                pass

    out["elapsed"] = round(time.time() - started, 1)
    out["findings"] = responsive_findings(out)
    landed = out.get("final_url")
    if landed:
        want, got = urlsplit(url).path.rstrip("/"), urlsplit(landed).path.rstrip("/")
        if want != got:
            out["findings"].insert(0, F(
                "redirect", "WARN", "Landed on a different page",
                f"{url} ended up at {landed}. Every finding below describes that "
                "page, not the one you asked for.",
                [f"asked for  {want or '/'}", f"ended at   {got or '/'}"]))
    out["shot_widths"] = sorted(shots)
    return out, shots
