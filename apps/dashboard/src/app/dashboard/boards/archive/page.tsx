import Link from "next/link";
import { ArrowLeft, Link2, Search } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { UnarchiveButton } from "@/components/boards/archive-button";
import { BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { isStage } from "@/lib/boards";

export const metadata = { title: "Archived boards" };

/**
 * The archive. Everything an archived board ever held is still here — cards,
 * comments, screenshots, the event log, the assignees — and the board itself
 * still opens and still works. Archiving moved one timestamp; restoring
 * clears it.
 *
 * The search is server-side on purpose. This list only grows, and a filter
 * that ships every archived board to the browser is a page that gets slower
 * every month forever.
 */
export default async function ArchivedBoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAuth();
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const projects = await db.project.findMany({
    where: {
      boardArchivedAt: { not: null },
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" as const } },
              { client: { name: { contains: term, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      boardShareId: true,
      boardArchivedAt: true,
      client: { select: { name: true } },
      boardArchivedBy: { select: { name: true } },
      pages: { select: { issues: { where: { boardStage: { not: null } }, select: { boardStage: true } } } },
    },
    orderBy: { boardArchivedAt: "desc" },
  });

  const total = term
    ? await db.project.count({ where: { boardArchivedAt: { not: null } } })
    : projects.length;

  return (
    <>
      <PageHeader
        title="Archived boards"
        subtitle="Put away, not deleted. Every card, comment and screenshot is still attached — restoring one puts it straight back on the Boards page."
        action={
          <Link
            href="/dashboard/boards"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
            Boards
          </Link>
        }
      />

      <form method="get" className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          name="q"
          defaultValue={term}
          placeholder="Search archived boards by project or client…"
          aria-label="Search archived boards"
          className="h-10 w-full rounded-lg border border-border-soft bg-card pl-9 pr-3 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
      </form>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card px-4 py-14 text-center">
          <p className="text-sm text-text-secondary">
            {term ? `No archived board matches “${term}”.` : "Nothing is archived."}
          </p>
          {term && (
            <p className="mt-1.5 text-[13px] text-text-muted">
              {total} board{total === 1 ? " is" : "s are"} archived in total.
            </p>
          )}
        </div>
      ) : (
        <>
          {term && (
            <p className="mb-3 text-[13px] text-text-secondary">
              {projects.length} of {total} archived board{total === 1 ? "" : "s"}.
            </p>
          )}
          <ul className="overflow-hidden rounded-xl border border-border-soft bg-card">
            {projects.map((p) => {
              const counts = new Map<BoardStage, number>();
              for (const pg of p.pages)
                for (const i of pg.issues)
                  if (isStage(i.boardStage)) counts.set(i.boardStage, (counts.get(i.boardStage) ?? 0) + 1);
              const cards = [...counts.values()].reduce((n, c) => n + c, 0);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 border-t border-border-soft px-4 py-3 transition-colors first:border-t-0 hover:bg-card-soft"
                >
                  <Link href={`/dashboard/boards/${p.id}`} className="group min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary group-hover:underline">
                      {p.name}
                    </span>
                    <span className="block truncate text-[13px] text-text-secondary">
                      {p.client.name} · {cards} card{cards === 1 ? "" : "s"}
                      {cards > 0 && (
                        <> · {[...counts.entries()].map(([s, c]) => `${c} ${BOARD_STAGE_LABELS[s].toLowerCase()}`).join(" · ")}</>
                      )}
                    </span>
                  </Link>

                  {/* An archived board can still have a live developer link.
                      Saying so keeps that a visible decision rather than a
                      URL nobody is watching any more. */}
                  {p.boardShareId && (
                    <span
                      title="This archived board still has a live developer link"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/[0.14] px-2 py-1 text-[11px] font-medium text-warning-strong"
                    >
                      <Link2 className="size-3" strokeWidth={2} />
                      link still live
                    </span>
                  )}

                  <span className="shrink-0 text-[12px] text-text-muted">
                    {p.boardArchivedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {p.boardArchivedBy?.name ? ` · ${p.boardArchivedBy.name}` : ""}
                  </span>

                  <UnarchiveButton projectId={p.id} name={p.name} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
