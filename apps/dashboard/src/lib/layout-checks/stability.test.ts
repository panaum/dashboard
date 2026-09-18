import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceRunKeys, stabilityOf, stabilitySentence, stabilityWords, viewportRunKeys, type RunKeys } from "./stability";

const run = (checkedAt: string, ...keys: string[]): RunKeys => ({ checkedAt, keys: new Set(keys) });
const D = ["2026-09-16T05:00:00Z", "2026-09-15T05:00:00Z", "2026-09-14T05:00:00Z", "2026-09-13T05:00:00Z", "2026-09-12T05:00:00Z", "2026-09-11T05:00:00Z", "2026-09-10T05:00:00Z"];

test("a fault in every run of the window is a fixture, dated from the oldest run that has it", () => {
  const runs = D.slice(0, 6).map((d) => run(d, "tap-small|a.cta"));
  const s = stabilityOf("tap-small|a.cta", runs);
  assert.deepEqual(s, { seen: 6, of: 6, since: D[5], persistent: true, flapping: false });
  assert.equal(stabilityWords(s), "in every run since 11 Sept");
  assert.match(stabilitySentence(s) ?? "", /^In every one of the last 6 runs, since 11 Sept\.$/);
});

test("a fault that comes and goes is a flap, however many times it was seen", () => {
  const runs = [run(D[0], "x|"), run(D[1]), run(D[2], "x|"), run(D[3]), run(D[4], "x|"), run(D[5])];
  const s = stabilityOf("x|", runs);
  assert.equal(s?.flapping, true);
  assert.equal(s?.seen, 3);
  assert.equal(s?.since, D[0], "the streak from now is this run alone");
  assert.equal(stabilityWords(s), "comes and goes — 3 of the last 6 runs");
  assert.match(stabilitySentence(s) ?? "", /Confirm it against the screenshot/);
});

test("this run and the last, nothing older: ordinary, no chip, but the prompt says so", () => {
  const s = stabilityOf("x|", [run(D[0], "x|"), run(D[1], "x|"), run(D[2]), run(D[3])]);
  assert.deepEqual(s, { seen: 2, of: 4, since: D[1], persistent: false, flapping: false });
  assert.equal(stabilityWords(s), null);
  assert.equal(stabilitySentence(s), "Reported on the last run too.");
});

test("new this run says nothing here — run-diff already says 'new'", () => {
  const s = stabilityOf("x|", [run(D[0], "x|"), run(D[1]), run(D[2])]);
  assert.equal(s?.seen, 1);
  assert.equal(stabilityWords(s), null);
  assert.equal(stabilitySentence(s), null);
});

test("a fault not in this run, or only one run to look at, is not marked", () => {
  assert.equal(stabilityOf("x|", [run(D[0]), run(D[1], "x|")]), null);
  assert.equal(stabilityOf("x|", [run(D[0], "x|")]), null);
});

test("two runs in every run is not a fixture worth a chip — the window is too short to say", () => {
  const s = stabilityOf("x|", [run(D[0], "x|"), run(D[1], "x|")]);
  assert.equal(s?.persistent, true);
  assert.equal(stabilityWords(s), null);
});

test("only the window counts, newest first", () => {
  const runs = [...D.slice(0, 6).map((d) => run(d, "x|")), run(D[6])];   // absent in the 7th, outside the window
  assert.equal(stabilityOf("x|", runs)?.persistent, true);
});

test("a device run's keys are its audited devices' faults, as reach.ts keys them", () => {
  const k = deviceRunKeys(D[0], [
    { status: "ok", findings: [{ rule: "tap-small", selector: "a.cta" }, { rule: "cls", selector: "html", scope: "page" }] },
    { status: "blocked", findings: [{ rule: "text-small", selector: "p" }] },
  ]);
  assert.deepEqual([...k.keys].sort(), ["cls|", "tap-small|a.cta"]);
});

test("a viewports run's keys are the rules that failed or warned", () => {
  const k = viewportRunKeys(D[0], [{ id: "overflow", status: "FAIL" }, { id: "edge", status: "PASS" }, { id: "clipped", status: "WARN" }]);
  assert.deepEqual([...k.keys].sort(), ["clipped", "overflow"]);
});
