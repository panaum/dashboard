import { test } from "node:test";
import assert from "node:assert/strict";
import { railItems, railSlice, shortLabel } from "./findings-view";

const f = (rule: string, message: string, severity = "warn", extra: object = {}) => ({ rule, message, severity, ...extra });

test("short labels come from the audit's own templates", () => {
  assert.equal(shortLabel(f("tap-small", "a:nth-of-type(1) is 101×15px — under the 24px WCAG AA minimum")), "Tap target 101 × 15");
  assert.equal(shortLabel(f("tap-close", "a and a are 7.8px apart; small touch targets need 8px between them")), "Tap targets 7.8px apart");
  assert.equal(shortLabel(f("tap-close", "a:nth-of-type(1) and a:nth-of-type(2) are touching; small touch targets need 8px between them")), "Tap targets touching");
  assert.equal(shortLabel(f("overflow", "The page scrolls sideways by 14px (407px wide in a 393px viewport)")), "Horizontal overflow — 14px");
  assert.equal(shortLabel(f("overflow", "div#culprit extends 60px past the viewport")), "Extends 60px past viewport");
  assert.equal(shortLabel(f("element-wider", "img.elIMG.ximg extends 35px past the right edge (12% of it is clipped and cannot be seen)")), "Cut off at edge — 35px");
  assert.equal(shortLabel(f("clipped-text", "p.x hides 18px of text below its box")), "Text clipped — 18px hidden");
  assert.equal(shortLabel(f("text-small", "div.ax-hp-hero__label is set at 9.8px; body text under 12px is hard to read on a phone")), "Text 9.8px on a phone");
  assert.equal(shortLabel(f("fixed-chrome", "Fixed bars take 26% of the viewport (73px top, 0px bottom of 280px)")), "Fixed bars take 26% of screen");
  assert.equal(shortLabel(f("viewport-meta", "Viewport meta blocks zoom (width=device-width,initial-scale=1,maximum-scale=1); that fails WCAG 1.4.4 for low-vision users")), "Zoom blocked by viewport meta");
  assert.equal(shortLabel(f("viewport-meta", 'No <meta name="viewport">: phones lay the page out at desktop width and shrink it')), "No viewport meta");
  assert.equal(shortLabel(f("image-size", "img.kb-img is served at 335px for a 335px slot on a 3x screen — under 670px it will look soft")), "Soft image — 335px for 335px");
  assert.equal(shortLabel(f("image-size", "img is served at 2028px for a 493px slot on a 2x screen — more than twice the 986px this device can show")), "Oversized image — 2028px for 493px");
  assert.equal(shortLabel(f("cls", "Cumulative layout shift 0.537 — content jumps around while loading (poor is above 0.25)", "error")), "Layout shift 0.537");
  assert.equal(shortLabel(f("webfont", "Poppins-Regular was skipped on this load: it is declared font-display: optional, so the browser kept the fallback")), "Webfont skipped — Poppins-Regular");
  assert.equal(shortLabel(f("webfont", "Webfont failed to load: missing-font.woff2 — HTTP 404", "error")), "Webfont failed — missing-font.woff2");
  assert.equal(shortLabel(f("webfont", "Page requests Apple's system font (-apple-system / SF Pro); it is substituted on this backend", "info")), "Apple system font substituted");
  assert.equal(shortLabel(f("tap-small", "7 more small tap target(s) not listed", "info")), "7 more not listed");
  assert.equal(shortLabel(f("tap-small", "12 more small tap target(s) not listed — 6 under the 24px AA minimum, 6 between 24 and 44px", "info")), "12 more not listed");
  assert.equal(shortLabel(f("new-rule", "Something odd happened on the page here", "warn")), "New rule: Something odd happened on");
});

test("rail order: errors, then warnings, then info; top of the page first; page-level last in its band", () => {
  const items = railItems([
    f("tap-small", "a is 20×20px — under the 24px WCAG AA minimum", "warn", { box: { x: 0, y: 900, width: 20, height: 20 }, selector: "a" }),
    f("cls", "Cumulative layout shift 0.4 — content jumps", "error", { scope: "page", selector: "html", box: { x: 0, y: 0, width: 393, height: 852 } }),
    f("overflow", "The page scrolls sideways by 14px (407px wide in a 393px viewport)", "error", { box: { x: 0, y: 120, width: 407, height: 40 }, selector: "div.hero" }),
    f("image-size", "img is served at 100px for a 100px slot on a 3x screen — under 300px it will look soft", "info", { box: { x: 0, y: 10, width: 100, height: 100 }, selector: "img" }),
    f("tap-small", "b is 20×20px — under the 24px WCAG AA minimum", "warn", { box: { x: 0, y: 100, width: 20, height: 20 }, selector: "b" }),
  ]);
  assert.deepEqual(items.map((i) => i.label), ["Horizontal overflow — 14px", "Layout shift 0.4", "Tap target 20 × 20", "Tap target 20 × 20", "Soft image — 100px for 100px"]);
  assert.deepEqual(items.map((i) => i.selector), ["div.hero", null, "b", "a", "img"]);
  assert.equal(items[1].pageLevel, true); assert.equal(items[1].box, null);
});

test("the rail shows five, then says how many more", () => {
  const ten = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(railSlice(ten, false), { shown: [0, 1, 2, 3, 4], hidden: 5 });
  assert.deepEqual(railSlice(ten, true), { shown: ten, hidden: 0 });
  assert.deepEqual(railSlice([1, 2], false), { shown: [1, 2], hidden: 0 });
});
