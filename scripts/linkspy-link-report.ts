/**
 * Dry-run report: which Dashboard pages COULD be linked to a LinkSpy site.
 *
 * Writes nothing. Ever. It prints proposals for a human to act on, because a
 * wrong registrySiteId silently annotates a page's checklist with another
 * site's live verdicts — worse than no link at all.
 *
 *   npx tsx scripts/linkspy-link-report.ts
 *   npx tsx scripts/linkspy-link-report.ts --sites ./sites-snapshot.json
 *
 * Site source:
 *   default   the LinkSpy REGISTRY bridge (LINKSPY_API_URL + LINKSPY_API_KEY) —
 *             i.e. exactly what this app is architecturally allowed to see. A
 *             site with no client_id does not appear here at all.
 *   --sites   a JSON array snapshot ({id,url,name,client_id,monitoring_enabled}),
 *             for planning against LinkSpy's full site table before annotation.
 *
 * Pages come from DATABASE_URL via Prisma (read-only queries).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import {
  matchPages, blockers, hostOf, type PageRow, type SiteRow, type Proposal,
} from "../src/lib/linkspy/link-match";

const db = new PrismaClient();
const TIMEOUT_MS = 15000;

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

async function sitesFromRegistry(): Promise<SiteRow[]> {
  const base = (process.env.LINKSPY_API_URL || "").replace(/\/$/, "");
  const key = process.env.LINKSPY_API_KEY || "";
  if (!base || !key) {
    console.error(
      "LINKSPY_API_URL / LINKSPY_API_KEY are unset.\n" +
      "Set them, or pass --sites <snapshot.json> to plan offline.",
    );
    process.exit(2);
  }
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  };

  const { clients } = await get("/api/registry/clients?search=");
  const out: SiteRow[] = [];
  for (const c of clients ?? []) {
    const { sites } = await get(`/api/registry/clients/${encodeURIComponent(c.id)}/sites`);
    for (const s of sites ?? []) {
      // Anything reachable through the registry has a client by construction;
      // monitoring state is not exposed here, so it stays unknown.
      out.push({ id: s.id, url: s.url, name: s.name, hasClient: true });
    }
  }
  return out;
}

function sitesFromSnapshot(path: string): SiteRow[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.sites ?? [];
  return rows.map((s: Record<string, unknown>) => ({
    id: String(s.id),
    url: (s.url as string) ?? null,
    name: (s.name as string) ?? null,
    hasClient: s.client_id != null,
    monitored: s.monitoring_enabled === true,
  }));
}

function describe(p: Proposal): string {
  const lines: string[] = [];
  const label = `${p.page.clientName} › ${p.page.name}`;
  lines.push(`  ${label}\n    page: ${p.page.url}  (host ${hostOf(p.page.url)})`);
  for (const s of p.exact) {
    const b = blockers(s);
    lines.push(`    → EXACT  ${s.id}  ${s.url}${b.length ? `\n             ⚠ ${b.join("; ")}` : ""}`);
  }
  for (const s of p.nearby) {
    const b = blockers(s);
    lines.push(`    ~ NEARBY ${s.id}  ${s.url}${b.length ? `\n             ⚠ ${b.join("; ")}` : ""}`);
  }
  return lines.join("\n");
}

async function main() {
  const snapshot = arg("--sites");
  const sites = snapshot ? sitesFromSnapshot(snapshot) : await sitesFromRegistry();

  const pages: PageRow[] = (
    await db.page.findMany({
      select: {
        id: true, name: true, url: true, registrySiteId: true,
        project: { select: { client: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    })
  ).map((p) => ({
    id: p.id, name: p.name, url: p.url, registrySiteId: p.registrySiteId,
    clientName: p.project.client.name,
  }));

  const r = matchPages(pages, sites);
  const withUrl = pages.length - r.noUrl.length;

  console.log("═".repeat(72));
  console.log(`LinkSpy link report — DRY RUN, nothing written`);
  console.log(`source: ${snapshot ? `snapshot ${snapshot}` : "registry bridge"}`);
  console.log("═".repeat(72));
  console.log(`pages            ${pages.length} total · ${withUrl} with a URL · ${r.alreadyLinked.length} already linked`);
  console.log(`sites            ${sites.length} visible`);
  console.log(`proposals        ${r.confident.length} confident · ${r.ambiguous.length} need review`);
  console.log(`unmatched        ${r.unmatched.length} pages LinkSpy has never seen`);
  console.log(`unused sites     ${r.unusedSites.length} sites no page points at`);

  if (r.confident.length) {
    console.log(`\n── CONFIDENT (one exact host match) ${"─".repeat(36)}`);
    for (const p of r.confident) console.log(describe(p));
  }
  if (r.ambiguous.length) {
    console.log(`\n── NEEDS REVIEW (several hits, or tail-only) ${"─".repeat(27)}`);
    for (const p of r.ambiguous) console.log(describe(p));
  }

  const blocked = [...r.confident, ...r.ambiguous].flatMap((p) =>
    [...p.exact, ...p.nearby].filter((s) => blockers(s).length),
  );
  if (blocked.length) {
    console.log(
      `\n⚠ ${blocked.length} candidate site(s) are LinkSpy-side blocked (no client_id, or\n` +
      `  monitoring off). Linking to those produces silence, not verdicts — fix them\n` +
      `  in LinkSpy first.`,
    );
  }

  console.log(`\nNothing was written. To link, use the picker on the page detail view.`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("report failed:", e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
