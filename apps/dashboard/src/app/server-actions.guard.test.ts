import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Every export of a "use server" file is a public endpoint: anyone holding the
// action id can POST to it, whatever the UI shows. Until 2026-09-24 most of
// them checked nothing past "signed in" (and five board helpers not even
// that). This pins the rule: each exported action asks for a capability
// before it does anything, or is listed below with the reason it need not.
// ─────────────────────────────────────────────────────────────────────────────

// A capability guard, in any of the forms the action files use.
const GUARD = /\b(actorWith|guard|can|canSignQa|self)\(/;

// Actions that deliberately take no capability. Each needs a reason.
const EXEMPT: Record<string, string> = {
  "src/app/login/actions.ts#login": "signing in: there is no actor yet",
  "src/app/dashboard/actions.ts#logout": "signing out is never rank-gated",
  "src/app/dashboard/boards/actions.ts#markCardViewed": "records the caller's own view; every rank may read a board",
  "src/app/dashboard/preview/actions.ts#exitPreview": "only deletes the caller's own preview cookie, and must work while a preview makes everything else read-only",
};

// Files authorised by something other than the session.
const TOKEN_AUTHED: Record<string, RegExp> = {
  // The developer's board: the capability link is the credential.
  "src/app/b/[boardShareId]/actions.ts": /boardShareId/,
};

function serverActionFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...serverActionFiles(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.")) {
      if (/^\s*["']use server["']/.test(readFileSync(resolve(process.cwd(), p), "utf8"))) out.push(p);
    }
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Each exported async function's name and the first ~12 lines of its body —
 *  the guard belongs at the top, not somewhere after the work. */
function actions(src: string): { name: string; head: string }[] {
  const code = stripComments(src);
  const out: { name: string; head: string }[] = [];
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    // Skip the parameter list (which may contain braces) to find the body.
    let i = m.index + m[0].length, depth = 1;
    while (depth && i < code.length) { if (code[i] === "(") depth++; else if (code[i] === ")") depth--; i++; }
    let angle = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === "<") angle++; else if (c === ">") angle--; else if (c === "{" && angle === 0) break;
      i++;
    }
    out.push({ name: m[1], head: code.slice(i, i + 900).split("\n").slice(0, 12).join("\n") });
  }
  return out;
}

test("every exported server action checks a capability first", () => {
  const files = serverActionFiles();
  assert.ok(files.length > 10, "found the action files");
  for (const f of files) {
    const src = readFileSync(resolve(process.cwd(), f), "utf8");
    if (TOKEN_AUTHED[f]) {
      assert.match(src, TOKEN_AUTHED[f], `${f} must check its token`);
      continue;
    }
    for (const a of actions(src)) {
      if (EXEMPT[`${f}#${a.name}`]) continue;
      assert.match(a.head, GUARD, `${f} → ${a.name}() must check a capability before doing anything (or be listed in EXEMPT with a reason)`);
    }
  }
});

test("every exemption still names a real action", () => {
  for (const key of Object.keys(EXEMPT)) {
    const [f, name] = key.split("#");
    assert.match(readFileSync(resolve(process.cwd(), f), "utf8"), new RegExp(`export async function ${name}\\b`), `${key} no longer exists; drop it`);
  }
});
