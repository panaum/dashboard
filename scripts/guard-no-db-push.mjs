#!/usr/bin/env node
// Data-Safety guard (ADR-001): `prisma db push` and `--force-reset` are BANNED.
// `db push` mutates the schema with no migration history and no reversibility
// record; `--force-reset` DROPS THE ENTIRE DATABASE. Both are incompatible with
// a no-PITR production DB. Use `npm run db:migrate` (dev) / `npm run db:deploy`
// (prod) instead — additive, reviewed, dump-gated.
//
// Wired as `prebuild`, so any build FAILS if a banned command is reintroduced
// into package.json scripts. Also runnable directly: `npm run guard:db`.
// Accepts an optional path to a package.json (used by the Gate −1 exit test to
// prove the guard fails on a db-push script).

import { readFileSync } from "node:fs";

const target = process.argv[2] || "package.json";

// Patterns assembled from fragments so this guard file never trips itself.
const DB = "db", PUSH = "push";
const FORBIDDEN = [
  { re: new RegExp(`prisma\\s+${DB}\\s+${PUSH}\\b`, "i"), why: "prisma db push (no migration history / no reversibility)" },
  { re: new RegExp(`\\b${DB}:${PUSH}\\b`), why: "a db:push script alias" },
  { re: /--force-reset\b/, why: "--force-reset (drops the entire database)" },
];

let pkg;
try {
  pkg = JSON.parse(readFileSync(target, "utf8"));
} catch (e) {
  console.error(`✖ db-push guard: cannot read ${target}: ${e.message}`);
  process.exit(2);
}

const scripts = pkg.scripts || {};
const offenders = [];
for (const [name, cmd] of Object.entries(scripts)) {
  if (name === "guard:db" || name === "prebuild") continue; // the guard itself
  for (const { re, why } of FORBIDDEN) {
    if (re.test(String(cmd))) offenders.push({ name, cmd, why });
  }
}

if (offenders.length) {
  console.error("✖ Data-Safety guard FAILED — banned schema command found (ADR-001):");
  for (const o of offenders) console.error(`   • script "${o.name}": ${o.cmd}\n     → ${o.why}`);
  console.error("   Use `npm run db:migrate` (dev) or `npm run db:deploy` (prod) instead.");
  process.exit(1);
}

console.log("✓ db-push guard: no banned schema commands in package.json scripts.");
