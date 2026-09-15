// Contrast, measured on the rendered page.
//
// The unit test beside contrast.ts checks the tokens' arithmetic and that no
// colour is used undeclared. It cannot tell which SURFACE a class sits on —
// and that is exactly what went wrong in #95, where a light-card token landed
// on the dark stage at 2.70:1. Only the browser knows what is actually behind
// a given run of text.
//
//   node scripts/contrast-audit.mjs <url> [--json]
//
// Walks every element with its own text, resolves the effective background by
// climbing until something is opaque, and applies AA: 4.5:1, or 3:1 for large
// text (>=24px, or >=18.66px bold) and for elements that carry no text of
// their own. Exits non-zero if anything fails.

import { chromium } from "playwright";

const url = process.argv[2];
const asJson = process.argv.includes("--json");
if (!url) { console.error("usage: node scripts/contrast-audit.mjs <url> [--json]"); process.exit(2); }

const PROBE = () => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => fg.rgb.map((v, i) => Math.round(v * fg.a + bg[i] * (1 - fg.a)));
  const ground = (el) => {
    let cur = el, acc = null;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) acc = acc === null ? (c.a === 1 ? c.rgb : over(c, [255, 255, 255])) : over({ rgb: acc, a: 1 }, c.rgb);
      if (c && c.a === 1) return acc ?? c.rgb;
      cur = cur.parentElement;
    }
    return acc ?? [255, 255, 255];
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // An icon is an <svg> drawn in currentColor. A text-less <span> is
    // decoration — the device bezel is made of them — and decoration carries
    // no information, so AA has nothing to say about it.
    if (el.closest('[aria-hidden="true"]') && !own) continue;
    const isIcon = !own && el.tagName === "svg" && r.width <= 40 && r.height <= 40;
    if (!own && !isIcon) continue;
    const fg = parse(s.color); if (!fg) continue;
    const bg = ground(el);
    const eff = fg.a < 1 ? over(fg, bg) : fg.rgb;
    const la = lum(eff), lb = lum(bg);
    const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    const px = parseFloat(s.fontSize), w = Number(s.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && w >= 700);
    const min = isIcon || large ? 3 : 4.5;
    if (ratio < min) {
      const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).slice(0, 4).join(" ");
      out.push({ ratio: +ratio.toFixed(2), min, px, weight: w, kind: isIcon ? "icon" : "text",
                 tag: el.tagName.toLowerCase(), cls: cls.slice(0, 80),
                 text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48),
                 color: s.color, bg: `rgb(${bg.join(", ")})` });
    }
  }
  // One row per distinct (class, ratio): a list repeats its own row styling.
  const seen = new Set();
  return out.filter((f) => { const k = `${f.cls}|${f.ratio}`; if (seen.has(k)) return false; seen.add(k); return true; })
            .sort((a, b) => a.ratio - b.ratio);
};

// AUDIT_CHROMIUM points at an existing Chromium when this checkout has no
// downloaded browsers of its own (`npx playwright install chromium` otherwise).
const b = await chromium.launch(process.env.AUDIT_CHROMIUM ? { executablePath: process.env.AUDIT_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
if (process.env.AUDIT_COOKIE) {
  const u = new URL(url);
  await ctx.addCookies([{ name: "session", value: process.env.AUDIT_COOKIE, domain: u.hostname, path: "/" }]);
}
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: "domcontentloaded" });
await pg.waitForTimeout(3500);
const fails = await pg.evaluate(PROBE);
await b.close();

if (asJson) { console.log(JSON.stringify(fails, null, 2)); }
else if (!fails.length) { console.log(`contrast: no failures on ${url}`); }
else {
  console.log(`contrast: ${fails.length} failing element(s) on ${url}\n`);
  for (const f of fails) {
    console.log(`  ${String(f.ratio).padStart(5)}:1 (needs ${f.min})  ${f.kind} ${f.px}px/${f.weight}  <${f.tag}> ${f.cls}`);
    if (f.text) console.log(`          "${f.text}"`);
    console.log(`          ${f.color} on ${f.bg}`);
  }
}
process.exit(fails.length ? 1 : 0);
