// One-off: create the default checklist template from the built-in QA_TEMPLATE.
// Idempotent — does nothing if any template already exists.
import { PrismaClient } from "@prisma/client";
import { QA_TEMPLATE } from "../src/lib/qa-template";

const db = new PrismaClient();

async function main() {
  const existing = await db.checklistTemplate.count();
  if (existing > 0) {
    console.log(`templates already exist (${existing}) — skipping`);
    return;
  }
  let order = 0;
  const items = QA_TEMPLATE.flatMap((g) =>
    g.items.map((it) => ({
      category: g.category,
      name: it.name,
      hasDualValue: it.hasDualValue ?? false,
      isMeasurement: it.isMeasurement ?? false,
      order: order++,
    })),
  );
  await db.checklistTemplate.create({
    data: { name: "Standard QA checklist", isDefault: true, items: { create: items } },
  });
  console.log(`seeded default template with ${items.length} items`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
