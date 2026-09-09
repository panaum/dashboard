import { test } from "node:test";
import assert from "node:assert/strict";
import {
  devicesChip, displayName, filterRows, lastCheckedIso, lastCheckedWords, listSummary,
  rowRank, sortRows, thumbSrc, viewportsChip, type ListRow,
} from "@/lib/layout-checks/list-view";

const NOW = Date.parse("2026-09-07T12:00:00Z");
const row = (over: Partial<ListRow> = {}): ListRow => ({
  id: "r1", url: "https://client.com/lp/", label: null,
  viewports: null, devices: null, thumb: null, ...over,
});

test("a page is named by its label, else its bare URL", () => {
  assert.equal(displayName(row()), "client.com/lp");
  assert.equal(displayName(row({ label: "Winter LP" })), "Winter LP");
  assert.equal(displayName(row({ label: "   " })), "client.com/lp", "a blank label is not a name");
});

test("the width chip counts breaks, not verdict words", () => {
  assert.deepEqual(viewportsChip(null), { label: "Not run", tone: "neutral" });
  assert.deepEqual(viewportsChip({ checkedAt: "x", worst: "FAIL", failCount: 2, warnCount: 3 }),
    { label: "2 breaks", tone: "error" });
  assert.deepEqual(viewportsChip({ checkedAt: "x", worst: "FAIL", failCount: 1, warnCount: 0 }),
    { label: "1 break", tone: "error" });
  assert.deepEqual(viewportsChip({ checkedAt: "x", worst: "WARN", failCount: 0, warnCount: 4 }),
    { label: "4 to review", tone: "warning" });
  assert.deepEqual(viewportsChip({ checkedAt: "x", worst: "PASS", failCount: 0, warnCount: 0 }),
    { label: "Clean", tone: "success" });
  assert.deepEqual(viewportsChip({ checkedAt: "x", worst: "SKIP", failCount: 0, warnCount: 0 }),
    { label: "Couldn't check", tone: "neutral" }, "a check that could not run is not a pass");
});

test("the device chip says how many devices vouched for it", () => {
  assert.deepEqual(devicesChip(null), { label: "Not run", tone: "neutral" });
  assert.deepEqual(devicesChip({ checkedAt: "x", worst: "PASS", errorCount: 0, warnCount: 0, deviceCount: 14 }),
    { label: "Clean on 14", tone: "success" });
  assert.deepEqual(devicesChip({ checkedAt: "x", worst: "FAIL", errorCount: 3, warnCount: 9, deviceCount: 14 }),
    { label: "3 errors", tone: "error" });
  assert.deepEqual(devicesChip({ checkedAt: "x", worst: "REGRESSED", errorCount: 0, warnCount: 0, deviceCount: 14 }),
    { label: "Changed", tone: "warning" });
  assert.deepEqual(devicesChip({ checkedAt: "x", worst: "BLOCKED", errorCount: 0, warnCount: 0, deviceCount: 14 }),
    { label: "Blocked", tone: "neutral" });
});

test("last checked takes the newer of the two checks", () => {
  const r = row({
    viewports: { checkedAt: "2026-09-01T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 },
    devices: { checkedAt: "2026-09-05T00:00:00Z", worst: "PASS", errorCount: 0, warnCount: 0, deviceCount: 14 },
  });
  assert.equal(lastCheckedIso(r), "2026-09-05T00:00:00Z");
  assert.match(lastCheckedWords(r, NOW), /^checked /);
  assert.equal(lastCheckedWords(row(), NOW), "never checked");
  assert.equal(lastCheckedIso(row()), null);
});

test("worst first, and a page nobody has checked outranks a clean one", () => {
  const broken = row({ id: "broken", viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "FAIL", failCount: 1, warnCount: 0 } });
  const warn = row({ id: "warn", viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "WARN", failCount: 0, warnCount: 2 } });
  const never = row({ id: "never" });
  const clean = row({ id: "clean", viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 } });
  assert.deepEqual(sortRows([clean, never, warn, broken], "worst").map((r) => r.id),
    ["broken", "warn", "never", "clean"]);
});

test("a kind that never ran does not count against the page", () => {
  const cleanWidthsOnly = row({
    viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 },
  });
  assert.equal(rowRank(cleanWidthsOnly), 3, "clean, even though the device matrix has never run");
  assert.equal(rowRank(row()), 2, "nothing has run at all: an open question");
});

test("a page is ranked by its worse half, not its kinder one", () => {
  const mixed = row({
    viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 },
    devices: { checkedAt: "2026-09-06T00:00:00Z", worst: "FAIL", errorCount: 2, warnCount: 0, deviceCount: 14 },
  });
  assert.equal(rowRank(mixed), 0, "clean at eight widths does not excuse two device errors");
});

test("recent sort puts the never-checked last rather than first", () => {
  const old = row({ id: "old", viewports: { checkedAt: "2026-09-01T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 } });
  const fresh = row({ id: "fresh", viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 } });
  const never = row({ id: "never" });
  assert.deepEqual(sortRows([old, never, fresh], "recent").map((r) => r.id), ["fresh", "old", "never"]);
});

test("name sort is alphabetical by what is on screen", () => {
  const rows = [row({ id: "b", label: "Zebra" }), row({ id: "a", label: "Apple" })];
  assert.deepEqual(sortRows(rows, "name").map((r) => r.id), ["a", "b"]);
});

test("sorting never mutates the caller's array", () => {
  const rows = [row({ id: "a" }), row({ id: "b" })];
  sortRows(rows, "name");
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
});

test("search matches the name and the URL", () => {
  const rows = [
    row({ id: "1", url: "https://breezioac.com/lp/", label: "Breezio winter" }),
    row({ id: "2", url: "https://fautons.com/", label: null }),
  ];
  assert.deepEqual(filterRows(rows, "breez").map((r) => r.id), ["1"]);
  assert.deepEqual(filterRows(rows, "WINTER").map((r) => r.id), ["1"], "case does not matter");
  assert.deepEqual(filterRows(rows, "fautons.com").map((r) => r.id), ["2"]);
  assert.deepEqual(filterRows(rows, "  ").map((r) => r.id), ["1", "2"], "an empty search hides nothing");
  assert.deepEqual(filterRows(rows, "nothing").map((r) => r.id), []);
});

test("the thumbnail points at whichever screenshot the run stored", () => {
  assert.equal(thumbSrc(null), null);
  assert.equal(thumbSrc({ kind: "width", runId: "r1", width: 350 }), "/api/layout-shot?runId=r1&width=350");
  assert.equal(thumbSrc({ kind: "device", runId: "r2", profile: "iphone-16" }),
    "/api/devicepreview/shot?runId=r2&profile=iphone-16");
});

test("the summary leads with what is wrong", () => {
  const broken = row({ viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "FAIL", failCount: 1, warnCount: 0 } });
  const warn = row({ viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "WARN", failCount: 0, warnCount: 2 } });
  const clean = row({ viewports: { checkedAt: "2026-09-06T00:00:00Z", worst: "PASS", failCount: 0, warnCount: 0 } });
  assert.equal(listSummary([broken, warn, clean, row()]), "1 page breaking · 1 to review · 1 never checked");
  assert.equal(listSummary([clean, clean]), "All 2 pages clean.");
  assert.equal(listSummary([]), "");
});
