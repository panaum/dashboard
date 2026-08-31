import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!p.includes("node_modules")) walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts")) {
      acc.push(p.replace(/\\/g, "/"));
    }
  }
  return acc;
}

const files = walk("src");

// T4: no background code (API routes / cron / drain / inbox proxies) may write
// the human QACheckItem table. Machine results live in LinkSpy's qa_prefills; the
// only bridge into a human row is the confirm action.
test("no API route touches the human QACheckItem table (T4)", () => {
  const offenders = files
    .filter((f) => f.includes("/src/app/api/") || f.includes("src/app/api/"))
    .filter((f) => /db\.qACheckItem\./.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "API/background code must never write QACheckItem");
});

// The provenance write (confirmedSource='machine') exists ONLY in the confirm
// bridge — the human click, which also stamps provenance.
test("provenance is written only by the confirm bridge, with a stamp", () => {
  const writers = files.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /db\.qACheckItem\.update/.test(s) && /confirmedSource:\s*"machine"/.test(s);
  });
  assert.equal(writers.length, 1, "exactly one file writes machine provenance to the DB");
  assert.ok(writers[0].endsWith("[pageId]/actions.ts"), `unexpected provenance writer: ${writers[0]}`);
  const src = readFileSync(writers[0], "utf8");
  // the confirm write stamps source + who + when
  assert.match(src, /confirmedSource:\s*"machine"/);
  assert.match(src, /confirmedBy:/);
  assert.match(src, /confirmedAt:\s*new Date\(\)/);
});
