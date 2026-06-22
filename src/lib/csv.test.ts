import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, csvResponse } from "./csv";

// ─── RFC-4180 quoting ─────────────────────────────────────────────────────────

test("plain values are not quoted; rows joined with CRLF", () => {
  const csv = toCsv(["A", "B"], [["x", "y"]]);
  assert.equal(csv, "A,B\r\nx,y");
});

test("commas, quotes and newlines force quoting; inner quotes are doubled", () => {
  assert.equal(toCsv(["H"], [["a,b"]]), 'H\r\n"a,b"');
  assert.equal(toCsv(["H"], [['a"b']]), 'H\r\n"a""b"');
  assert.equal(toCsv(["H"], [["a\nb"]]), 'H\r\n"a\nb"');
});

test("null and undefined become empty cells", () => {
  assert.equal(toCsv(["H"], [[null, undefined]]), "H\r\n,");
});

test("numbers are rendered as-is", () => {
  assert.equal(toCsv(["H"], [[0, 42, -3]]), "H\r\n0,42,-3");
});

// ─── Formula-injection guard ──────────────────────────────────────────────────

test("cells starting with = + @ are prefixed with a quote", () => {
  assert.equal(toCsv(["H"], [["=1+1"]]), "H\r\n'=1+1");
  assert.equal(toCsv(["H"], [["+1+2"]]), "H\r\n'+1+2");
  assert.equal(toCsv(["H"], [["@SUM(A1)"]]), "H\r\n'@SUM(A1)");
});

test("a dangerous formula that also needs quoting gets both treatments", () => {
  // leading '=' → quote-prefixed, embedded '"' → RFC-4180 quoted + doubled.
  assert.equal(toCsv(["H"], [['=HYPERLINK("x")']]), 'H\r\n"\'=HYPERLINK(""x"")"');
});

test("a name starting with '-' is neutralised, but a negative number is not", () => {
  assert.equal(toCsv(["H"], [["-Dash Co Ltd"]]), "H\r\n'-Dash Co Ltd");
  // numeric strings/numbers must stay numeric (e.g. a delay of -3)
  assert.equal(toCsv(["H"], [["-3"]]), "H\r\n-3");
  assert.equal(toCsv(["H"], [[-3]]), "H\r\n-3");
});

// ─── csvResponse ──────────────────────────────────────────────────────────────

test("csvResponse prepends a UTF-8 BOM and sets download headers", async () => {
  const res = csvResponse("A,B\r\n1,2", "report-2026-01.csv");
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.equal(
    res.headers.get("content-disposition"),
    'attachment; filename="report-2026-01.csv"',
  );

  // Assert on raw bytes: Response.text() strips a leading BOM on decode, so the
  // BOM is only observable at the byte level (EF BB BF).
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf], "starts with UTF-8 BOM");
  assert.equal(new TextDecoder().decode(bytes), "A,B\r\n1,2");
});
