import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPrompt, type PromptFinding } from "./fix-prompt";

// A real rail: wbiwarm.com on the Galaxy S25, 2026-09-17.
const RUN: PromptFinding[] = [
  { label: "Layout shift 0.389", message: "The page moves under the reader while it loads (CLS 0.389).",
    selector: null, pageLevel: true, severity: "error", reach: "6 of 14 devices",
    why: "Content jumps as late images and fonts arrive, so a tap lands on the wrong thing.",
    fix: "Reserve the space: width and height on images, and a min-height on anything injected." },
  { label: "Tap target 77 × 14", message: "77 × 14 CSS px, under the 24px minimum.",
    selector: "a.wm-cta-m:nth-of-type(1)", severity: "warn", reach: "9 of 14 devices",
    why: "A target this small is hard to hit with a thumb.",
    fix: "Padding on the link, or a minimum height on the row." },
  { label: "-apple-system requested", message: "The page names -apple-system; this engine drew it authentically.",
    selector: null, pageLevel: true, severity: "info" },
];
const CTX = { url: "https://wbiwarm.com/wbi-mechanical-systems/", where: "Samsung Galaxy S25 · Chromium · 412 × 892" };

test("the prompt names the page, the device and how many things need fixing", () => {
  const p = fixPrompt(RUN, CTX);
  assert.match(p, /^This page was checked on real device sizes and 2 things need fixing\./);
  assert.match(p, /Page: https:\/\/wbiwarm\.com\/wbi-mechanical-systems\/$/m);
  assert.match(p, /Measured on: Samsung Galaxy S25 · Chromium · 412 × 892$/m);
});

test("every measurement the tool took travels with it", () => {
  const p = fixPrompt(RUN, CTX);
  assert.match(p, /1\. Layout shift 0\.389/);
  assert.match(p, /Element: the page as a whole/);
  assert.match(p, /2\. Tap target 77 × 14/);
  assert.match(p, /Element: a\.wm-cta-m:nth-of-type\(1\)/);
  assert.match(p, /Measured: 77 × 14 CSS px, under the 24px minimum\./);
  assert.match(p, /Why it matters: A target this small is hard to hit with a thumb\./);
  assert.match(p, /Usual fix: Padding on the link/);
  assert.match(p, /Seen on: 9 of 14 devices/);
});

test("a note is kept out of the work and said to be a note", () => {
  const p = fixPrompt(RUN, CTX);
  assert.match(p, /Also noted, not necessarily to fix:/);
  const noted = p.slice(p.indexOf("Also noted"));
  assert.match(noted, /-apple-system requested/);
  // The things to fix are numbered 1 and 2 — the note is not a third.
  assert.doesNotMatch(p.slice(0, p.indexOf("Also noted")), /-apple-system/);
});

test("the fix is constrained: smallest change, other sizes, and a way to disagree", () => {
  const p = fixPrompt(RUN, CTX);
  assert.match(p, /Change the smallest thing/);
  assert.match(p, /a fix for one must not break another/);
  assert.match(p, /starting point, not an instruction/);
  assert.match(p, /If an item is deliberate and right as it is, leave it and say so\./);
  assert.match(p, /say which of these you changed and which you left/);
});

test("one finding is not asked for in the plural", () => {
  const p = fixPrompt([RUN[1]], CTX);
  assert.match(p, /one thing needs fixing/);
  assert.match(p, /^The finding:$/m);
});

test("notes alone do not ask for work", () => {
  const p = fixPrompt([RUN[2]], CTX);
  assert.match(p, /nothing is failing/);
  assert.doesNotMatch(p, /How to fix:/);
  assert.doesNotMatch(p, /say which of these you changed/);
});

test("nothing at all copies nothing", () => {
  assert.equal(fixPrompt([], CTX), "");
});

// ── one page, every device ───────────────────────────────────────────────
import { mergePageFindings, type DeviceItems } from "./fix-prompt";

const FLEET: DeviceItems[] = [
  { device: "Samsung Galaxy S25", items: [
      { rule: "cls", label: "Layout shift 0.389", message: "CLS 0.389", selector: null, pageLevel: true, severity: "error" },
      { rule: "tap-size", label: "Tap target 77 × 14", message: "77×14px", selector: "a.wm-cta-m:nth-of-type(1)", severity: "warn" },
      { rule: "tap-size", label: "Tap target 80 × 14", message: "80×14px", selector: "a.wm-cta-m:nth-of-type(1)", severity: "warn" },
  ]},
  { device: "iPhone 16", items: [
      { rule: "tap-size", label: "Tap target 77 × 14", message: "77×14px", selector: "a.wm-cta-m:nth-of-type(1)", severity: "warn" },
      { rule: "text-size", label: "Text 11.0px on a phone", message: "11.0px", selector: "span.wm-m", severity: "warn" },
  ]},
  { device: "iPad Air 11\"", items: [
      { rule: "text-size", label: "Text 11.0px on a tablet", message: "11.0px", selector: "span.wm-m", severity: "info" },
  ]},
];

test("the same fault on many devices is one item, counted", () => {
  const merged = mergePageFindings(FLEET);
  const tap = merged.find((f) => f.selector === "a.wm-cta-m:nth-of-type(1)");
  assert.ok(tap);
  assert.equal(tap.reach, "2 of 3 devices");
  // Two rows on the S25 for the same element is still one device.
  assert.equal(merged.filter((f) => f.selector === "a.wm-cta-m:nth-of-type(1)").length, 1);
});

test("a fault on one device says which one", () => {
  const cls = mergePageFindings(FLEET).find((f) => f.pageLevel);
  assert.equal(cls?.reach, "only on Samsung Galaxy S25");
});

test("the worst severity wins, and the item reads as the device that failed", () => {
  const merged = mergePageFindings(FLEET);
  const text = merged.find((f) => f.selector === "span.wm-m");
  assert.equal(text?.severity, "warn", "a warning on the phone outranks a note on the tablet");
  assert.equal(text?.label, "Text 11.0px on a phone");
});

test("errors first, then whatever lands on the most devices", () => {
  const merged = mergePageFindings(FLEET);
  assert.deepEqual(merged.map((f) => f.severity), ["error", "warn", "warn"]);
  assert.equal(merged[1].selector, "a.wm-cta-m:nth-of-type(1)", "2 devices before 2 devices, ties on label");
});

test("everywhere is said as everywhere", () => {
  const everywhere: DeviceItems[] = FLEET.map((d) => ({ ...d, items: [
    { rule: "cls", label: "Layout shift", selector: null, pageLevel: true, severity: "error" }] }));
  assert.equal(mergePageFindings(everywhere)[0].reach, "all 3 devices");
});

test("why it matters and the usual fix are looked up once per fault", () => {
  const calls: string[] = [];
  const merged = mergePageFindings(FLEET, (rule) => { calls.push(rule); return { why: `why ${rule}`, fix: `fix ${rule}` }; });
  assert.equal(merged.find((f) => f.pageLevel)?.why, "why cls");
  assert.deepEqual(calls.sort(), ["cls", "tap-size", "text-size"]);
});

test("the merged list goes into the same prompt", () => {
  const p = fixPrompt(mergePageFindings(FLEET), { url: "https://x.test/p", where: "all 3 device profiles" });
  assert.match(p, /3 things need fixing/);
  assert.match(p, /Measured on: all 3 device profiles/);
  assert.match(p, /Seen on: only on Samsung Galaxy S25/);
});

test("an item says whether it is new or has been waiting since the last run", () => {
  const p = fixPrompt([{ ...RUN[1], since: "still" }, { ...RUN[0], since: "new" }], CTX);
  assert.match(p, /Tap target 77 × 14[\s\S]*Since: reported on the last run too/);
  assert.match(p, /Layout shift 0\.389[\s\S]*Since: new this run/);
  // Without a previous run there is no line at all.
  assert.doesNotMatch(fixPrompt([RUN[1]], CTX), /Since:/);
});

test("an item carries the element's own numbers and its tag, for the fix", () => {
  const p = fixPrompt([{ ...RUN[1], now: "font-size 11px · padding 0px · 77×14px", html: '<a class="wm-cta-m" href="/quote">' }], CTX);
  assert.match(p, /Now: font-size 11px · padding 0px · 77×14px/);
  assert.match(p, /Tag: <a class="wm-cta-m" href="\/quote">/);
  assert.doesNotMatch(fixPrompt([RUN[1]], CTX), /Now:|Tag:/);
});
