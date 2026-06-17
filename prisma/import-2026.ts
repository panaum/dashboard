import { PrismaClient } from "@prisma/client";
import { buildChecklistItems } from "../src/lib/qa-template";
import { DATA, type Proj, type Del } from "./import-data";

// Bulk imports use the DIRECT connection (session mode, port 5432) when set —
// the transaction-mode pooler drops long-running scripts (P1017).
const db = new PrismaClient(
  process.env.DIRECT_URL
    ? { datasources: { db: { url: process.env.DIRECT_URL } } }
    : undefined,
);

// --- helpers ----------------------------------------------------------------

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

const firstName = (s: string) =>
  s.split(/[/&]/)[0].trim();

function platform(raw: string): string {
  const p = raw.toLowerCase();
  if (p.includes("worpdress") || p.includes("wordpress")) return "WORDPRESS";
  if (p.includes("webflow")) return "WEBFLOW";
  if (p.includes("unbounce")) return "UNBOUNCE";
  if (p.includes("hubspot")) return "HUBSPOT";
  if (p.includes("podia")) return "PODIA";
  if (p.includes("ghl")) return "GHL";
  if (p.includes("wix")) return "WIX";
  if (p.includes("kajabi")) return "KAJABI";
  if (p.includes("clickfunnel")) return "CLICKFUNNEL";
  if (p.includes("elementor")) return "ELEMENTOR";
  if (p.includes("swipepages")) return "SWIPEPAGES";
  if (p.includes("learnworld")) return "LEARNWORLDS";
  return "OTHER";
}

// Known multi-page clients → canonical name + match tokens (lowercased substrings).
const KNOWN: { name: string; tokens: string[] }[] = [
  { name: "Savvio", tokens: ["savvio"] },
  { name: "BKCF", tokens: ["bkcf"] },
  { name: "Hutch", tokens: ["hutch"] },
  { name: "Lisa Marie", tokens: ["lisa marie"] },
  { name: "WBI", tokens: ["wbi"] },
  { name: "DR G", tokens: ["dr g", "gpx"] },
  { name: "Apexure", tokens: ["apexure"] },
  { name: "Trustia", tokens: ["trustia"] },
  { name: "Gem Revealed", tokens: ["gem revealed"] },
  { name: "Trading Cafe", tokens: ["trading cafe", "trading academy", "quick win"] },
  { name: "TCC", tokens: ["tcc"] },
  { name: "Option Goddess", tokens: ["option goddess", "og academy", "og |", "og:"] },
  { name: "Cyrene Labs", tokens: ["cyrene"] },
  { name: "Sandra Network", tokens: ["sandra net"] },
  { name: "Shopping Care", tokens: ["shopping care"] },
  { name: "Fawakih", tokens: ["fawakih"] },
  { name: "Forge 47", tokens: ["forge 47", "forge47", "f47", "ratehounds"] },
  { name: "LLUM", tokens: ["llum"] },
  { name: "Cookie Finance", tokens: ["cookie finance"] },
  { name: "Bindscout", tokens: ["bindscout"] },
  { name: "Updater", tokens: ["updater"] },
  { name: "Agency 2.0", tokens: ["agency 2.0"] },
  { name: "Exportize", tokens: ["exportize"] },
  { name: "Blace", tokens: ["blace"] },
  { name: "Kashmir Bloom", tokens: ["kashmir bloom"] },
  { name: "Chorus", tokens: ["chorus"] },
  { name: "Arabic Online", tokens: ["arabic online"] },
  { name: "Dr. Bashi", tokens: ["bashi"] },
  { name: "Anywhere Garage Doors", tokens: ["anywhere garage"] },
  { name: "Valley Solar", tokens: ["valley solar", "massachusetts installer"] },
];

const GENERIC = new Set([
  "build", "new", "affiliate", "request", "the", "a", "opt-in", "opt in funnel",
]);

function clientOf(name: string): string {
  const lower = name.toLowerCase();
  for (const k of KNOWN) {
    if (k.tokens.some((t) => lower.includes(t))) return k.name;
  }
  if (name.includes("|")) {
    const prefix = name.split("|")[0].trim();
    if (prefix.length > 2 && !GENERIC.has(prefix.toLowerCase())) return prefix;
  }
  return name.trim();
}

// --- main -------------------------------------------------------------------

type Row = {
  name: string;
  critical: number;
  medium: number;
  low: number;
  repetitive: number;
  platform: string;
  developer: string | null;
  tester: string | null;
  delay: number;
  month: string;
};

async function main() {
  // 0. Wipe existing data so the import is clean and re-runnable.
  await db.qACheckItem.deleteMany();
  await db.qACertificate.deleteMany();
  await db.issue.deleteMany();
  await db.page.deleteMany();
  await db.project.deleteMany();
  await db.client.deleteMany();
  await db.teamMember.deleteMany();

  // 1. Flatten + join projects with delivery (by normalized name) per month.
  const rows: Row[] = [];
  for (const { month, projects, delivery } of DATA) {
    const delMap = new Map<string, Del>();
    for (const d of delivery) delMap.set(norm(d[0]), d);
    for (const p of projects as Proj[]) {
      const [name, total, critical, medium, low, repetitive, plat] = p;
      const d = delMap.get(norm(name));
      const lowCount =
        low > 0 ? low : total > 0 && critical === 0 && medium === 0 && repetitive === 0 ? total : low;
      rows.push({
        name,
        critical,
        medium,
        low: lowCount,
        repetitive,
        platform: platform(plat),
        developer: d ? firstName(d[2]) : null,
        tester: d ? firstName(d[3]) : null,
        delay: d ? d[1] : 0,
        month,
      });
    }
  }

  // 2. Team members (dev = DEVELOPER, tester = TESTER, both = BOTH).
  const devs = new Set<string>();
  const testers = new Set<string>();
  for (const r of rows) {
    if (r.developer) devs.add(r.developer);
    if (r.tester) testers.add(r.tester);
  }
  const memberIds = new Map<string, string>();
  for (const name of new Set([...devs, ...testers])) {
    const role = devs.has(name) && testers.has(name) ? "BOTH" : devs.has(name) ? "DEVELOPER" : "TESTER";
    const m = await db.teamMember.upsert({
      where: { name },
      update: { role },
      create: { name, role },
    });
    memberIds.set(name, m.id);
  }

  // 3. Group rows by client.
  const byClient = new Map<string, Row[]>();
  for (const r of rows) {
    const c = clientOf(r.name);
    if (!byClient.has(c)) byClient.set(c, []);
    byClient.get(c)!.push(r);
  }

  // 4. Create client → project → pages → issues → certificates.
  let clientCount = 0,
    pageCount = 0,
    issueCount = 0;

  for (const [clientName, clientRows] of byClient) {
    const client = await db.client.create({ data: { name: clientName } });
    clientCount++;

    const isWebsite = clientRows.length > 1;
    // Most common platform among the client's pages.
    const counts = new Map<string, number>();
    for (const r of clientRows) counts.set(r.platform, (counts.get(r.platform) ?? 0) + 1);
    const topPlatform = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const project = await db.project.create({
      data: {
        clientId: client.id,
        name: isWebsite ? `${clientName} Website` : clientName,
        type: isWebsite ? "WEBSITE" : "LANDING_PAGE",
        platform: topPlatform,
        status: "LIVE",
      },
    });

    for (const r of clientRows) {
      const page = await db.page.create({
        data: {
          projectId: project.id,
          name: r.name,
          status: "LIVE",
          developerId: r.developer ? memberIds.get(r.developer) : null,
          testerId: r.tester ? memberIds.get(r.tester) : null,
          delayDays: r.delay,
          deliveryMonth: r.month,
        },
      });
      pageCount++;

      const issues: { pageId: string; title: string; severity: string; status: string }[] = [];
      const add = (n: number, sev: string) => {
        for (let i = 0; i < n; i++)
          issues.push({ pageId: page.id, title: `${r.name} — issue ${i + 1}`, severity: sev, status: "FIXED" });
      };
      add(r.critical, "CRITICAL_HIGH");
      add(r.medium, "MEDIUM");
      add(r.low, "LOW");
      add(r.repetitive, "REPETITIVE");
      if (issues.length) {
        await db.issue.createMany({ data: issues });
        issueCount += issues.length;
      }

      const cert = await db.qACertificate.create({
        data: { pageId: page.id, status: "PASS", completedAt: new Date(`${r.month}-15`) },
      });
      await db.qACheckItem.createMany({ data: buildChecklistItems(cert.id) });
    }
  }

  console.log(
    `\nImport complete: ${clientCount} clients, ${byClient.size} projects, ${pageCount} pages, ${issueCount} issues.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
