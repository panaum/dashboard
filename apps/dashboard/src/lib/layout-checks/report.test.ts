import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupHeadline, groupScope, reachWords, reportCoverage, reportGroups, reportItems, reportVerdict,
  splitGroups, type ReportDevice,
} from "@/lib/layout-checks/report";

const box = { x: 10, y: 100, width: 80, height: 14 };
const dev = (label: string, findings: ReportDevice["findings"], status = "ok"): ReportDevice =>
  ({ profileId: label.toLowerCase().replace(/\W+/g, "-"), label, engine: "chromium", status, findings });

test("the same fault on many devices is one item, naming them all", () => {
  const items = reportItems([
    dev("iPhone 16", [{ severity: "warn", rule: "tap-small", message: "a.cta is 80×14px", selector: "a.cta", box }]),
    dev("Galaxy S25", [{ severity: "warn", rule: "tap-small", message: "a.cta is 80×14px", selector: "a.cta", box }]),
    dev("Desktop", []),
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].devices, ["iPhone 16", "Galaxy S25"]);
  assert.equal(items[0].audited, 3);
  assert.equal(items[0].check, "Tap targets");
  assert.equal(items[0].sample?.label, "iPhone 16");
});

test("a device reporting the same fault twice still counts once", () => {
  const f = { severity: "warn", rule: "tap-small", message: "a.cta is 80×14px", selector: "a.cta", box };
  const items = reportItems([dev("iPhone 16", [f, { ...f }])]);
  assert.deepEqual(items[0].devices, ["iPhone 16"]);
});

test("the worst severity anywhere wins, and brings its wording", () => {
  const items = reportItems([
    dev("A", [{ severity: "warn", rule: "cls", message: "Cumulative layout shift 0.11", scope: "page" }]),
    dev("B", [{ severity: "error", rule: "cls", message: "Cumulative layout shift 0.533", scope: "page" }]),
  ]);
  assert.equal(items[0].severity, "error");
  assert.ok(items[0].message.includes("0.533"));
  assert.equal(items[0].pageLevel, true);
  assert.equal(items[0].sample, null);            // nothing to point at, so nothing to crop
});

test("devices that were not audited are neither counted nor consulted", () => {
  const items = reportItems([
    dev("Ran", [{ severity: "warn", rule: "text-small", message: "set at 11.0px", selector: "p", box }]),
    dev("Blocked", [{ severity: "error", rule: "text-small", message: "set at 11.0px", selector: "p", box }], "blocked"),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, "warn");
  assert.equal(items[0].audited, 1);
  assert.deepEqual(items[0].devices, ["Ran"]);
});

test("errors first, then by how far each reaches", () => {
  const b = { severity: "warn", rule: "tap-small", selector: "a.one", box, message: "a.one is 80×14px" };
  const items = reportItems([
    dev("A", [b, { severity: "warn", rule: "text-small", selector: "p", box, message: "set at 11.0px" },
              { severity: "error", rule: "overflow", selector: "div", box, message: "scrolls sideways by 40px" }]),
    dev("B", [b]),
  ]);
  assert.equal(items[0].rule, "overflow");                        // the error leads
  assert.deepEqual(items.slice(1).map((i) => i.devices.length), [2, 1]);   // then reach
});


test("coverage counts devices by their worst finding", () => {
  const c = reportCoverage([
    dev("A", [{ severity: "error", rule: "overflow", message: "x" }]),
    dev("B", [{ severity: "warn", rule: "tap-small", message: "x" }]),
    dev("C", []),
    dev("D", [], "blocked"),
  ]);
  assert.deepEqual(c, { failing: 1, warnings: 1, clean: 1, inconclusive: 1, audited: 3, total: 4 });
});

test("the verdict is a sentence, and it counts faults rather than devices", () => {
  const c = (over: Partial<ReturnType<typeof reportCoverage>>) => ({ failing: 0, warnings: 0, clean: 3, inconclusive: 0, audited: 3, total: 3, ...over });
  const item = (severity: "error" | "warn") => ({ severity } as never);
  assert.equal(reportVerdict(c({}), []).headline, "Clean on all 3 devices we checked");
  assert.equal(reportVerdict(c({ warnings: 2, clean: 1 }), []).tone, "warning");
  assert.equal(reportVerdict(c({ failing: 2 }), [item("error")]).headline, "One thing stands between this page and launch");
  assert.equal(reportVerdict(c({ failing: 2 }), [item("error"), item("error")]).headline, "2 things stand between this page and launch");
  assert.equal(reportVerdict(c({ total: 0, audited: 0, clean: 0 }), []).tone, "neutral");
  assert.equal(reportVerdict(c({ audited: 0, clean: 0, inconclusive: 3 }), []).headline,
               "Nothing could be checked — every device was blocked or failed to load the page");
});

test("reach reads as words, not a fraction", () => {
  const it = (devices: string[], audited: number) => ({ devices, audited } as never);
  assert.equal(reachWords(it(["a", "b", "c"], 3)), "on all 3 devices");
  assert.equal(reachWords(it(["iPhone SE"], 14)), "on the iPhone SE only");
  assert.equal(reachWords(it(["a", "b"], 14)), "on 2 of 14 devices");
});

test("the sample is the device where the fault sits highest, so a picture exists more often", () => {
  const at = (y: number) => ({ x: 10, y, width: 80, height: 14 });
  const f = (y: number) => ({ severity: "warn", rule: "tap-small", message: "a.cta is 80×14px", selector: "a.cta", box: at(y) });
  const items = reportItems([dev("Deep", [f(4000)]), dev("Shallow", [f(180)]), dev("Middle", [f(900)])]);
  assert.equal(items[0].sample?.label, "Shallow");
  assert.equal(items[0].sample?.box.y, 180);
  // a box of no size is not a sample at all
  assert.equal(reportItems([dev("A", [{ severity: "warn", rule: "tap-small", message: "x", selector: "a", box: { x: 0, y: 0, width: 0, height: 0 } }])])[0].sample, null);
});

test("the report groups by kind: one entry per rule, with its elements and reach", () => {
  const at = (y: number) => ({ x: 10, y, width: 80, height: 14 });
  const tap = (sel: string, y: number) => ({ severity: "warn", rule: "tap-small", message: `${sel} is 80×14px`, selector: sel, box: at(y) });
  const groups = reportGroups(reportItems([
    dev("iPhone 16", [tap("a.one", 900), tap("a.two", 200), { severity: "error", rule: "overflow", selector: "div", box: at(50), message: "scrolls sideways by 40px" }]),
    dev("Galaxy S25", [tap("a.one", 800)]),
  ]));
  assert.deepEqual(groups.map((g) => g.rule), ["overflow", "tap-small"]);       // the error leads
  const t = groups[1];
  assert.equal(t.headline, "Links and buttons too small to tap reliably");
  assert.equal(t.elements, 2);
  assert.deepEqual(t.devices, ["iPhone 16", "Galaxy S25"]);
  assert.equal(t.sample?.box.y, 200);                                          // the highest of the group
  assert.equal(groupScope(t), "2 elements, on all 2 devices");
  assert.equal(groupScope(groups[0]), "on the iPhone 16 only");
});

test("a group takes the worst severity among its findings", () => {
  const g = reportGroups(reportItems([
    dev("A", [{ severity: "warn", rule: "cls", message: "Cumulative layout shift 0.11", scope: "page" }]),
    dev("B", [{ severity: "error", rule: "cls", message: "Cumulative layout shift 0.533", scope: "page" }]),
  ]));
  assert.equal(g[0].severity, "error");
  assert.equal(g[0].headline, "The page jumps while it loads");
  assert.equal(g[0].elements, 0);
  assert.deepEqual(splitGroups(g).blocking.length, 1);
});

test("image findings say which way they are wrong", () => {
  const soft = [{ label: "Soft image — 600px for 372px", message: "img is served at 600px for a 372px slot — it will look soft" }] as never;
  const big = [{ label: "Oversized image — 2000px for 372px", message: "img is served at 2000px for a 372px slot" }] as never;
  assert.equal(groupHeadline("image-size", soft), "Photos will look soft on phones");
  assert.equal(groupHeadline("image-size", big), "Photos are larger than they need to be");
  assert.equal(groupHeadline("image-size", [...soft, ...big] as never), "Photos are the wrong size for the screen");
});

test("a rule with no headline written for it falls back to the short label, not to nothing", () => {
  assert.equal(groupHeadline("brand-new-rule", [{ label: "Brand new rule: something" }] as never), "Brand new rule: something");
});
