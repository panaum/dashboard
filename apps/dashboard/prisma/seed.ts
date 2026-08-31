import { PrismaClient } from "@prisma/client";
import { buildChecklistItems } from "../src/lib/qa-template";

const db = new PrismaClient();

const DEVELOPERS = [
  "Samiya",
  "Tajamul",
  "Arif",
  "Atul",
  "Viraj",
  "Jaziq",
  "Alok",
  "Ifrah",
];
const TESTERS = ["Babar Shah", "Anaum", "Wefia"];

async function main() {
  // Team members
  for (const name of DEVELOPERS) {
    await db.teamMember.upsert({
      where: { name },
      update: {},
      create: { name, role: "DEVELOPER" },
    });
  }
  for (const name of TESTERS) {
    await db.teamMember.upsert({
      where: { name },
      update: {},
      create: { name, role: "TESTER" },
    });
  }

  const samiya = await db.teamMember.findUnique({ where: { name: "Samiya" } });
  const anaum = await db.teamMember.findUnique({ where: { name: "Anaum" } });

  // Sample client → website → pages (from the January report: Savvio on Webflow)
  const savvio = await db.client.upsert({
    where: { name: "Savvio" },
    update: {},
    create: { name: "Savvio", notes: "Webflow website — multi-page build." },
  });

  const existing = await db.project.findFirst({
    where: { clientId: savvio.id, name: "Savvio Website" },
  });

  if (!existing) {
    const site = await db.project.create({
      data: {
        clientId: savvio.id,
        name: "Savvio Website",
        type: "WEBSITE",
        platform: "WEBFLOW",
        status: "IN_QA",
      },
    });

    const pages = [
      { name: "Home Page", issues: 10 },
      { name: "Checkout Page", issues: 5 },
      { name: "Thank You Page", issues: 5 },
      { name: "Pricing Page", issues: 4 },
      { name: "Blog Page", issues: 3 },
      { name: "Contact Page", issues: 3 },
    ];

    for (const p of pages) {
      const page = await db.page.create({
        data: {
          projectId: site.id,
          name: p.name,
          status: "IN_QA",
          developerId: samiya?.id,
          testerId: anaum?.id,
          deliveryMonth: "2026-01",
        },
      });

      // Seed low-severity issues to match the report counts
      await db.issue.createMany({
        data: Array.from({ length: p.issues }, (_, i) => ({
          pageId: page.id,
          title: `${p.name} issue ${i + 1}`,
          severity: "LOW",
          status: "OPEN",
        })),
      });

      // Blank certificate with the full checklist
      const cert = await db.qACertificate.create({
        data: { pageId: page.id, status: "IN_PROGRESS", testerName: "Anaum" },
      });
      await db.qACheckItem.createMany({ data: buildChecklistItems(cert.id) });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
