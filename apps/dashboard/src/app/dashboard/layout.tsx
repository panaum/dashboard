import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/board-alive";
import { Sidebar } from "@/components/shared/sidebar";
import { CommandPaletteLoader } from "@/components/shared/command-palette-loader";
import { PageTransition } from "@/components/shared/page-transition";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireAuth();

  // The badge on the Boards nav item: cards that are mine or that I reported,
  // where something has happened since I last opened them. The shared login
  // has no row to track views against, so it sees no badge rather than a
  // permanent one.
  let boardsUnread = 0;
  if (!actor.bootstrap) {
    const mine = await db.issue.findMany({
      where: {
        boardStage: { not: null },
        OR: [{ assigneeId: actor.id }, { reporterId: actor.id }],
      },
      select: {
        events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        views: { where: { viewerId: actor.id }, take: 1, select: { viewedAt: true } },
      },
    });
    boardsUnread = unreadCount(mine.map((i) => ({
      latestEventAt: i.events[0]?.createdAt ?? null,
      viewedAt: i.views[0]?.viewedAt ?? null,
    })));
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar actor={actor} boardsUnread={boardsUnread} />
      <main className="flex-1 px-8 py-7">
        <div className="mx-auto max-w-6xl has-[[data-wide]]:max-w-[1500px]">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <CommandPaletteLoader />
    </div>
  );
}
