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
  assert.match(p, /must not break another one/);
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
