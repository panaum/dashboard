import Link from "next/link";
import { Archive } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { ProjectPicker } from "@/components/boards/project-picker";
import { ArchiveButton } from "@/components/boards/archive-button";
import { BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { isStage } from "@/lib/boards";

export const metadata = { title: "Boards" };

// One board per project. A project appears here once it has any card on a
// board, or a developer link — unless it has been archived, in which case it
// lives on /dashboard/boards/archive with everything still attached to it.
export default async function BoardsPage() {
  await requireAuth();

  const projects = await db.project.findMany({
    where: {
      boardArchivedAt: null,
      OR: [
        { boardShareId: { not: null } },
        { pages: { some: { issues: { some: { boardStage: { not: null } } } } } },
      ],
    },
    select: {
      id: true, name: true, boardShareId: true, client: { select: { name: true } },
      pages: { select: { issues: { where: { boardStage: { not: null } }, select: { boardStage: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Every project that could become a board, whole — the picker searches it
  // rather than printing it, so there is no cap and nothing is unreachable.
  const startable = await db.project.findMany({
    where: { boardArchivedAt: null, id: { notIn: projects.map((p) => p.id) } },
    select: { id: true, name: true, client: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const archivedCount = await db.project.count({ where: { boardArchivedAt: { not: null } } });

  return (
    <>
      <PageHeader
        title="Boards"
        subtitle="Issues QA found, tracked to resolution with the developer who owns them."
        action={
          archivedCount > 0 ? (
            <Link
              href="/dashboard/boards/archive"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
            >
              <Archive className="size-4" strokeWidth={2} />
              Archived
              <span className="tabular-nums text-text-muted">{archivedCount}</span>
            </Link>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <p className="mb-6 text-[13px] text-text-secondary">
          No board is open. Search a project below to start one.
        </p>
      ) : (
        <ul className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const counts = new Map<BoardStage, number>();
            for (const pg of p.pages)
              for (const i of pg.issues)
                if (isStage(i.boardStage)) counts.set(i.boardStage, (counts.get(i.boardStage) ?? 0) + 1);
            const open = [...counts.entries()]
              .filter(([s]) => s !== "CLOSED")
              .reduce((n, [, c]) => n + c, 0);
            return (
              <li key={p.id} className="group relative">
                <Link
                  href={`/dashboard/boards/${p.id}`}
                  className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Card className="h-full px-5 py-4 transition-colors hover:bg-card-soft">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                      {p.client.name}
                    </p>
                    <p className="mt-1 pr-8 text-[15px] font-semibold text-text-primary">{p.name}</p>
                    <p className="mt-2 text-[13px] text-text-secondary">
                      {open} open{p.boardShareId ? " · developer link active" : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-text-secondary">
                      {[...counts.entries()]
                        .map(([s, c]) => `${c} ${BOARD_STAGE_LABELS[s].toLowerCase()}`)
                        .join(" · ")}
                    </p>
                  </Card>
                </Link>
                {/* Outside the Link, or it would be a button inside an anchor. */}
                <div className="absolute right-3 top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <ArchiveButton projectId={p.id} name={p.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Start a board
        </h2>
        <ProjectPicker
          projects={startable.map((p) => ({ id: p.id, name: p.name, client: p.client.name }))}
        />
      </section>
    </>
  );
}
