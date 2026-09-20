import Link from "next/link";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { isStage } from "@/lib/boards";

export const metadata = { title: "Boards" };

// One board per project. A project appears here once it has any card on a
// board, or a developer link — otherwise it has nothing to show and lives
// under Clients as before.
export default async function BoardsPage() {
  await requireAuth();
  const projects = await db.project.findMany({
    where: { OR: [{ boardShareId: { not: null } }, { pages: { some: { issues: { some: { boardStage: { not: null } } } } } }] },
    select: {
      id: true, name: true, boardShareId: true, client: { select: { name: true } },
      pages: { select: { issues: { where: { boardStage: { not: null } }, select: { boardStage: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const all = await db.project.findMany({
    where: { id: { notIn: projects.map((p) => p.id) } },
    select: { id: true, name: true, client: { select: { name: true } } },
    orderBy: { name: "asc" }, take: 50,
  });

  return (
    <>
      <PageHeader title="Boards" subtitle="Issues QA found, tracked to resolution with the developer who owns them." />
      {projects.length === 0 && (
        <p className="mb-6 text-[13px] text-text-secondary">No board has any cards yet. Open a project below to start one.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const counts = new Map<BoardStage, number>();
          for (const pg of p.pages) for (const i of pg.issues) if (isStage(i.boardStage)) counts.set(i.boardStage, (counts.get(i.boardStage) ?? 0) + 1);
          const open = [...counts.entries()].filter(([s]) => s !== "CLOSED").reduce((n, [, c]) => n + c, 0);
          return (
            <li key={p.id}>
              <Link href={`/dashboard/boards/${p.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <Card className="h-full px-5 py-4 transition-colors hover:bg-card-soft">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{p.client.name}</p>
                  <p className="mt-1 text-[15px] font-semibold text-text-primary">{p.name}</p>
                  <p className="mt-2 text-[13px] text-text-secondary">
                    {open} open{p.boardShareId ? " · developer link active" : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-text-secondary">
                    {[...counts.entries()].map(([s, c]) => `${c} ${BOARD_STAGE_LABELS[s].toLowerCase()}`).join(" · ")}
                  </p>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
      {all.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Start a board</h2>
          <ul className="flex flex-wrap gap-2">
            {all.map((p) => (
              <li key={p.id}>
                <Link href={`/dashboard/boards/${p.id}`} className="rounded-lg bg-card px-3 py-1.5 text-[13px] text-text-primary hover:bg-card-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  {p.client.name} · {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
