import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appliesAt, defaultWidth, findingsAt, firstWidthOf, hasPerWidth, rangeLabel,
  severityAt, viewportRail, widthShape, widthViewport, type ViewportFinding,
} from "@/lib/layout-checks/viewports-view";

const ALL = [350, 375, 425, 450, 470, 768, 1024, 1440];

const NEW: ViewportFinding[] = [
  { id: "overflow", status: "FAIL", title: "Horizontal overflow", detail: "The page scrolls sideways at 350–425.", widths: [350, 375, 425] },
  { id: "clipped", status: "WARN", title: "Clipped text", detail: "Two elements hide part of their text.", widths: [1440] },
  { id: "blocked", status: "SKIP", title: "Blocked at some widths", detail: "A bot challenge was served at 768.", widths: [768] },
  { id: "edge", status: "PASS", title: "Content cut off at the edge", detail: "Nothing runs past the edge.", widths: [350, 375, 425, 450, 470, 1024, 1440] },
  { id: "shots", status: "INFO", title: "Screenshots", detail: "8 full-page screenshots.", widths: ALL },
];
// A run saved before the engine attributed findings to widths.
const OLD: ViewportFinding[] = [
  { id: "overflow", status: "FAIL", title: "Horizontal overflow", detail: "The page scrolls sideways at 350–425." },
  { id: "edge", status: "PASS", title: "Content cut off at the edge", detail: "Nothing runs past the edge." },
];

test("a width knows its shape and the viewport it was rendered at", () => {
  assert.deepEqual(widthViewport(375), { width: 375, height: 812 });
  assert.deepEqual(widthViewport(1024), { width: 1024, height: 768 });
  assert.deepEqual(widthViewport(999), { width: 999, height: 900 }, "an unknown width still has a frame");
  assert.equal(widthShape(350), "phone");
  assert.equal(widthShape(470), "phone");
  assert.equal(widthShape(768), "tablet");
  assert.equal(widthShape(1440), "desktop");
});

test("per-width attribution is detected, not assumed", () => {
  assert.equal(hasPerWidth(NEW), true);
  assert.equal(hasPerWidth(OLD), false);
  assert.equal(hasPerWidth([]), false);
});

test("an unattributed finding applies everywhere rather than nowhere", () => {
  assert.equal(appliesAt(OLD[0], 1440), true);
  assert.equal(appliesAt(NEW[0], 1440), false);
  assert.equal(appliesAt(NEW[0], 350), true);
  assert.equal(findingsAt(OLD, 1440).length, OLD.length, "an old run is never silently empty");
  assert.deepEqual(findingsAt(NEW, 1440).map((f) => f.id), ["clipped", "edge", "shots"]);
});

test("the dot on a width says what is wrong there", () => {
  assert.equal(severityAt(NEW, 350), "error");
  assert.equal(severityAt(NEW, 1440), "warning");
  assert.equal(severityAt(NEW, 768), "warning", "blocked is not clean");
  assert.equal(severityAt(NEW, 470), "clean");
  assert.equal(severityAt(OLD, 350), "unknown", "an old run claims nothing per width");
});

test("the panel opens on the worst width, smallest first", () => {
  assert.equal(defaultWidth(NEW, ALL), 350);
  assert.equal(defaultWidth(NEW.filter((f) => f.status !== "FAIL"), ALL), 768);
  assert.equal(defaultWidth([], ALL), 350);
  assert.equal(defaultWidth(OLD, ALL), 350);
  assert.equal(defaultWidth(NEW, []), null);
});

test("ranges collapse the way the engine's prose does", () => {
  assert.equal(rangeLabel([350, 375, 425], ALL), "350–425");
  assert.equal(rangeLabel([350, 1440], ALL), "350, 1440");
  assert.equal(rangeLabel([350, 375, 1024, 1440], ALL), "350–375, 1024–1440");
  assert.equal(rangeLabel([768], ALL), "768");
  assert.equal(rangeLabel([], ALL), "");
  assert.equal(rangeLabel([999], ALL), "", "a width this run never took is not invented");
});

test("the rail carries what is wrong, not what is fine", () => {
  const rail = viewportRail(NEW, 350, ALL);
  assert.deepEqual(rail.map((r) => r.id), ["overflow"], "PASS and INFO are not findings");
  assert.equal(rail[0].severity, "error");
  assert.equal(rail[0].label, "Horizontal overflow");
  assert.equal(rail[0].selector, "350–425px");
  assert.equal(rail[0].box, null, "a width finding has no box to draw");
  assert.match(rail[0].detail ?? "", /scrolls sideways/);
  assert.deepEqual(viewportRail(NEW, 470, ALL), [], "a clean width gets the clean state");
});

test("worst first within a width", () => {
  const both: ViewportFinding[] = [
    { id: "b", status: "SKIP", title: "Blocked", widths: [350] },
    { id: "c", status: "WARN", title: "Clipped", widths: [350] },
    { id: "a", status: "FAIL", title: "Overflow", widths: [350] },
  ];
  assert.deepEqual(viewportRail(both, 350, ALL).map((r) => r.id), ["a", "c", "b"]);
  assert.deepEqual(viewportRail(both, 350, ALL).map((r) => r.severity), ["error", "warn", "warn"]);
});

test("an old run shows everything, labelled honestly", () => {
  const rail = viewportRail(OLD, 1440, ALL);
  assert.deepEqual(rail.map((r) => r.id), ["overflow"]);
  assert.equal(rail[0].selector, "widths not recorded");
});

test("selecting a finding jumps to the first width it names", () => {
  assert.equal(firstWidthOf(NEW[0], 470), 350);
  assert.equal(firstWidthOf(NEW[1], 350), 1440);
  assert.equal(firstWidthOf(OLD[0], 470), 470, "an unattributed finding moves nothing");
  assert.equal(firstWidthOf(undefined, 470), 470);
});
