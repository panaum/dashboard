import test from "node:test";
import assert from "node:assert/strict";

import {
  bandFor, blocked, byClient, byDeveloper, byPlatform, defectRate, defectRateBy, isRecurring,
  defectRateByMonth, makePeriod, MIN_N, previousPeriod, recurrenceRate, testerAdjustedDefectRate,
  testerCalibration, testerCoverage, testerRates, weightedDefectRate,
  type PageRow,
} from "./metrics";

// ─── fixtures ───────────────────────────────────────────────────────────────

const issues = (n: number, severity = "LOW", recurring = false) =>
  Array.from({ length: n }, () => ({ severity, recurring }));

let seq = 0;
const page = (o: Partial<PageRow> = {}): PageRow => ({
  id: `p${++seq}`,
  deliveryMonth: "2026-07",
  developerId: "d1",
  testerId: "t1",
  platform: "WORDPRESS",
  clientId: "c1",
  issues: [],
  ...o,
});
const pages = (n: number, o: Partial<PageRow> = {}) => Array.from({ length: n }, () => page(o));

const JUL_SEP = makePeriod(["2026-07", "2026-08", "2026-09"], "Jul–Sep");

// ─── periods ────────────────────────────────────────────────────────────────

test("the previous period is the same span, immediately before", () => {
  assert.deepEqual(previousPeriod(JUL_SEP).months, ["2026-04", "2026-05", "2026-06"]);
  // Across a year boundary, without a Date object anywhere near it.
  assert.deepEqual(previousPeriod(makePeriod(["2026-01", "2026-02"])).months, ["2025-11", "2025-12"]);
  assert.deepEqual(previousPeriod(makePeriod([])).months, []);
});

test("a period sorts and de-duplicates its months", () => {
  const p = makePeriod(["2026-09", "2026-07", "2026-09"]);
  assert.deepEqual(p.months, ["2026-07", "2026-09"]);
  assert.equal(p.label, "2026-07 – 2026-09");
});

// ─── defect rate ────────────────────────────────────────────────────────────

test("defect rate is issues per delivered page, and carries its n", () => {
  const m = defectRate([...pages(4, { issues: issues(10) }), page({ issues: issues(20) })], JUL_SEP);
  assert.equal(m.value, 12); // (4×10 + 20) / 5
  assert.equal(m.n, 5);
  assert.equal(m.confidence, "high");
});

test("below MIN_N a rate is computed but never trusted", () => {
  const m = defectRate(pages(MIN_N - 1, { issues: issues(3) }), JUL_SEP);
  assert.equal(m.n, 4);
  assert.equal(m.confidence, "insufficient");
  // The value is still there — the page decides to suppress it; the metric
  // layer does not lie about what it computed.
  assert.equal(m.value, 3);
});

test("a page with no issues is a zero, not a gap", () => {
  const m = defectRate(pages(5, { issues: [] }), JUL_SEP);
  assert.equal(m.value, 0);
  assert.equal(m.n, 5);
  assert.equal(m.confidence, "high");
});

test("no pages at all yields null, never NaN or 0", () => {
  const m = defectRate([], JUL_SEP);
  assert.equal(m.value, null);
  assert.equal(m.n, 0);
  assert.equal(m.confidence, "insufficient");
  assert.equal(m.previousPeriodValue, null);
});

test("the previous period is measured, not assumed", () => {
  const m = defectRate(
    [...pages(5, { issues: issues(4) }), ...pages(5, { deliveryMonth: "2026-05", issues: issues(10) })],
    JUL_SEP,
  );
  assert.equal(m.value, 4);
  assert.equal(m.previousPeriodValue, 10);
});

test("pages outside the period, and undated pages, are not counted", () => {
  const m = defectRate(
    [...pages(5, { issues: issues(2) }),
     page({ deliveryMonth: "2025-01", issues: issues(99) }),
     page({ deliveryMonth: null, issues: issues(99) })],
    JUL_SEP,
  );
  assert.equal(m.n, 5);
  assert.equal(m.value, 2);
});

// ─── severity weighting ─────────────────────────────────────────────────────

test("a blocker and a padding error stop being one unit", () => {
  const p = [page({ issues: [
    { severity: "CRITICAL_HIGH", recurring: false },
    { severity: "MEDIUM", recurring: false },
    { severity: "LOW", recurring: false },
  ] }), ...pages(4, { issues: [] })];
  assert.equal(defectRate(p, JUL_SEP).value, 0.6);          // 3 issues / 5 pages
  assert.equal(weightedDefectRate(p, JUL_SEP).value, 2.4);  // (8+3+1) / 5 pages
});

test("an unknown severity weighs as a minor defect rather than crashing", () => {
  const p = pages(5, { issues: [{ severity: "WHO_KNOWS", recurring: false }] });
  assert.equal(weightedDefectRate(p, JUL_SEP).value, 1);
});

// ─── recurrence ─────────────────────────────────────────────────────────────

test("recurrence reads the flag and bridges the legacy severity", () => {
  assert.equal(isRecurring({ severity: "LOW", recurring: true }), true);
  assert.equal(isRecurring({ severity: "REPETITIVE", recurring: false }), true);
  assert.equal(isRecurring({ severity: "LOW", recurring: false }), false);
  // A critical bug that is also a repeat — impossible to express in the
  // legacy severity field, which is exactly why `recurring` exists.
  assert.equal(isRecurring({ severity: "CRITICAL_HIGH", recurring: true }), true);
});

test("recurrence rate counts issues, not pages, and n is the issue count", () => {
  const p = [
    page({ issues: [...issues(3), ...issues(1, "LOW", true)] }),
    page({ issues: issues(4, "REPETITIVE") }),
  ];
  const m = recurrenceRate(p, JUL_SEP);
  assert.equal(m.n, 8);                 // issues, not the 2 pages
  assert.equal(m.value, 62.5);          // 5 of 8
  assert.equal(m.confidence, "high");
});

test("recurrence over a board with no issues is null, not zero", () => {
  assert.equal(recurrenceRate(pages(5, { issues: [] }), JUL_SEP).value, null);
});

// ─── grouping ───────────────────────────────────────────────────────────────

test("grouping ranks worst first and pushes unrankable cells to the end", () => {
  const cells = defectRateBy(
    [
      ...pages(5, { developerId: "steady", issues: issues(2) }),
      ...pages(6, { developerId: "struggling", issues: issues(9) }),
      ...pages(1, { developerId: "one-page", issues: [] }),
    ],
    JUL_SEP,
    byDeveloper,
  );
  assert.deepEqual(cells.map((c) => c.key), ["struggling", "steady", "one-page"]);
  // The one-page developer would otherwise rank joint-best on a single page.
  assert.equal(cells[2].confidence, "insufficient");
  assert.equal(cells[2].n, 1);
});

test("rows with no developer are skipped rather than grouped under null", () => {
  const cells = defectRateBy(
    [...pages(5, { developerId: null, issues: issues(9) }), ...pages(5, { issues: issues(1) })],
    JUL_SEP,
    byDeveloper,
  );
  assert.deepEqual(cells.map((c) => c.key), ["d1"]);
});

test("the same grouping works for client and platform", () => {
  const rows = [
    ...pages(5, { clientId: "acme", platform: "KAJABI", issues: issues(8) }),
    ...pages(5, { clientId: "globex", platform: "WORDPRESS", issues: issues(2) }),
  ];
  assert.deepEqual(defectRateBy(rows, JUL_SEP, byClient).map((c) => [c.key, c.value]),
    [["acme", 8], ["globex", 2]]);
  assert.deepEqual(defectRateBy(rows, JUL_SEP, byPlatform).map((c) => [c.key, c.value]),
    [["KAJABI", 8], ["WORDPRESS", 2]]);
});

test("a group compares against its own previous period", () => {
  const cells = defectRateBy(
    [...pages(5, { issues: issues(3) }),
     ...pages(5, { deliveryMonth: "2026-04", issues: issues(7) })],
    JUL_SEP,
    byDeveloper,
  );
  assert.equal(cells[0].value, 3);
  assert.equal(cells[0].previousPeriodValue, 7);
});

// ─── tester adjustment ──────────────────────────────────────────────────────

/** Two testers who look with different intensity, each reviewing one
 *  developer exclusively. Raw rates differ 2×; all of it is the tester. */
const twoTesters = () => [
  ...pages(5, { developerId: "dev-harsh-reviewer", testerId: "t-harsh", issues: issues(10) }),
  ...pages(5, { developerId: "dev-easy-reviewer", testerId: "t-easy", issues: issues(5) }),
];

test("the adjustment divides the tester back out", () => {
  const cells = testerAdjustedDefectRate(twoTesters(), JUL_SEP);
  const harsh = cells.find((c) => c.key === "dev-harsh-reviewer")!;
  const easy = cells.find((c) => c.key === "dev-easy-reviewer")!;

  assert.equal(harsh.raw, 10);
  assert.equal(easy.raw, 5);
  // Both developers are indistinguishable once the reviewer is accounted for:
  // the raw 2× gap was entirely who happened to review them.
  assert.equal(harsh.value, 7.5);
  assert.equal(easy.value, 7.5);
  assert.equal(harsh.expected, 10);
  assert.equal(easy.expected, 5);
});

test("two testers is a correction factor, not a control, and says so", () => {
  const cells = testerAdjustedDefectRate(twoTesters(), JUL_SEP);
  assert.equal(cells[0].confidence, "low");
  assert.match(cells[0].note!, /correction factor, not a control/);
});

test("three testers earns full confidence", () => {
  const cells = testerAdjustedDefectRate(
    [...twoTesters(), ...pages(5, { developerId: "d3", testerId: "t3", issues: issues(6) })],
    JUL_SEP,
  );
  assert.equal(cells.every((c) => c.confidence === "high"), true);
  assert.equal(cells.every((c) => c.note === undefined), true);
});

test("a single tester cannot adjust anything — raw is surfaced, flagged", () => {
  const cells = testerAdjustedDefectRate(pages(10, { issues: issues(7) }), JUL_SEP);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].value, null, "no adjusted number is invented");
  assert.equal(cells[0].raw, 7, "the confounded number stays visible");
  assert.equal(cells[0].confidence, "insufficient");
  assert.match(cells[0].note!, /Not enough tester data/);
});

test("a reviewer too small to trust is left out of the mix, not guessed at", () => {
  // t-tiny reviews 2 pages: below MIN_TESTER_PAGES, so it cannot weigh in.
  const rows = [
    ...twoTesters(),
    ...pages(5, { developerId: "d3", testerId: "t3", issues: issues(6) }),
    ...pages(2, { developerId: "d4", testerId: "t-tiny", issues: issues(30) }),
  ];
  const d4 = testerAdjustedDefectRate(rows, JUL_SEP).find((c) => c.key === "d4")!;
  assert.equal(d4.expected, null);
  assert.equal(d4.value, null);
  assert.equal(d4.raw, 30);
  assert.match(d4.note!, /No reviewer with enough pages/);
});

test("a developer below MIN_N stays insufficient even with a good adjustment", () => {
  const rows = [
    ...twoTesters(),
    ...pages(5, { developerId: "d3", testerId: "t3", issues: issues(6) }),
    ...pages(2, { developerId: "rookie", testerId: "t-harsh", issues: issues(4) }),
  ];
  const rookie = testerAdjustedDefectRate(rows, JUL_SEP).find((c) => c.key === "rookie")!;
  assert.equal(rookie.n, 2);
  assert.equal(rookie.confidence, "insufficient");
});

test("tester rates and coverage are auditable next to the adjusted number", () => {
  const rows = [
    ...pages(6, { developerId: "d1", testerId: "t-harsh", issues: issues(10) }),
    ...pages(2, { developerId: "d1", testerId: "t-easy", issues: issues(2) }),
    ...pages(5, { developerId: "d2", testerId: "t-easy", issues: issues(4) }),
  ];
  assert.deepEqual(testerRates(rows, JUL_SEP).map((t) => [t.testerId, t.pages, t.rate]),
    [["t-easy", 7, 3.43], ["t-harsh", 6, 10]]);

  const cov = testerCoverage(rows, JUL_SEP, "d1");
  assert.deepEqual(cov.map((c) => [c.testerId, c.pages, c.share]),
    [["t-harsh", 6, 0.75], ["t-easy", 2, 0.25]]);
});

test("a page with no tester shows up in coverage as unassigned", () => {
  const cov = testerCoverage([...pages(3), ...pages(1, { testerId: null })], JUL_SEP, "d1");
  assert.deepEqual(cov.map((c) => c.testerId), ["t1", "unassigned"]);
});

// ─── tester calibration ─────────────────────────────────────────────────────

test("calibration reports divergence from the mean, not a verdict", () => {
  const cells = testerCalibration(twoTesters(), JUL_SEP);
  const harsh = cells.find((c) => c.key === "t-harsh")!;
  const easy = cells.find((c) => c.key === "t-easy")!;
  assert.equal(harsh.value, 10);
  assert.equal(easy.value, 5);
  // Grand mean is 7.5: one runs 1.33× it, the other 0.67×.
  assert.equal(harsh.divergence, 1.33);
  assert.equal(easy.divergence, 0.67);
  assert.equal(harsh.n, 5);
});

test("calibration carries the severity mix a tester tends to record", () => {
  const rows = pages(5, {
    testerId: "t-mix",
    issues: [
      { severity: "CRITICAL_HIGH", recurring: false },
      { severity: "LOW", recurring: false },
      { severity: "LOW", recurring: false },
    ],
  });
  const cell = testerCalibration(rows, JUL_SEP)[0];
  assert.deepEqual(cell.severityMix, { CRITICAL_HIGH: 5, LOW: 10 });
});

// ─── blocked ────────────────────────────────────────────────────────────────

test("a blocked metric is null with a reason, never a zero", () => {
  const m = blocked(JUL_SEP, "No QA round is recorded on a page.");
  assert.equal(m.value, null);
  assert.equal(m.confidence, "blocked");
  assert.equal(m.n, 0);
  assert.equal(m.note, "No QA round is recorded on a page.");
  // The distinction that matters: blocked ≠ zero ≠ insufficient.
  assert.notEqual(m.confidence, defectRate([], JUL_SEP).confidence);
  assert.notEqual(m.value, defectRate(pages(5, { issues: [] }), JUL_SEP).value);
});

// ─── month series ───────────────────────────────────────────────────────────

test("the month series runs in calendar order, never by value", () => {
  const rows = [
    ...pages(5, { deliveryMonth: "2026-09", issues: issues(2) }),
    ...pages(5, { deliveryMonth: "2026-07", issues: issues(9) }),
  ];
  const series = defectRateByMonth(rows, JUL_SEP);
  // Worst-first would put July on the left; a chart sorted by value is a lie.
  assert.deepEqual(series.map((c) => [c.key, c.value]), [["2026-07", 9], ["2026-09", 2]]);
});

test("a month with nothing delivered is absent, not a zero", () => {
  const series = defectRateByMonth(pages(5, { deliveryMonth: "2026-08" }), JUL_SEP);
  assert.deepEqual(series.map((c) => c.key), ["2026-08"]);
});

test("a thin month is still plotted, but flagged", () => {
  const series = defectRateByMonth(pages(2, { deliveryMonth: "2026-07", issues: issues(4) }), JUL_SEP);
  assert.equal(series[0].n, 2);
  assert.equal(series[0].confidence, "insufficient");
});

// ─── the data ramp ──────────────────────────────────────────────────────────

test("a band is a ratio of the period mean, not an absolute rate", () => {
  const mean = 8;
  assert.equal(bandFor(6, mean), "good");     // 0.75×
  assert.equal(bandFor(6.8, mean), "good");   // exactly 0.85× — the boundary is inclusive
  assert.equal(bandFor(7, mean), "watch");
  assert.equal(bandFor(10, mean), "watch");   // exactly 1.25×
  assert.equal(bandFor(10.1, mean), "poor");
  // The same rate lands in a different band when the team mean moves, which
  // is the point of expressing it as a ratio.
  assert.equal(bandFor(10, 14), "good");
});

test("a band is withheld rather than guessed when either side is missing", () => {
  assert.equal(bandFor(null, 8), null);
  assert.equal(bandFor(5, null), null);
  assert.equal(bandFor(5, 0), null, "a zero mean cannot divide");
  // A genuine zero defect rate is the best possible, not a missing band.
  assert.equal(bandFor(0, 8), "good");
});
