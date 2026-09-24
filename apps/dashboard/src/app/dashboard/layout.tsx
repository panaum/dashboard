import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/board-alive";
import { Sidebar } from "@/components/shared/sidebar";
import { CommandPaletteLoader } from "@/components/shared/command-palette-loader";
import { PageTransition } from "@/components/shared/page-transition";
import { Onboarding } from "@/components/onboarding/onboarding";
import { TourHost } from "@/components/onboarding/tour";
import { CAPABILITIES, can } from "@/lib/permissions";
import { CapabilityProvider } from "@/components/shared/capabilities";
import { PreviewBanner } from "@/components/shared/preview-banner";
import { accessState } from "@/lib/onboarding";

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

  // Pending rank requests, counted on the Team nav item for whoever can
  // answer them — the same badge the Boards item uses, not a second mechanism.
  const teamPending = can(actor, "rank:assign")
    ? await db.rankChangeRequest.count({ where: { status: "pending" } })
    : 0;

  // First-run onboarding for a person signed in as themselves who has not
  // finished or skipped it. The shared login has no row, so it never sees it.
  // Not during a preview either: an admin viewing as someone must not be
  // walked through that person's first-run flow.
  const me = actor.bootstrap || actor.preview ? null : await db.teamMember.findUnique({
    where: { id: actor.id },
    select: {
      id: true, name: true, nickname: true, avatarUpdatedAt: true, hasCompletedOnboarding: true,
      rankRequests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const caps = CAPABILITIES.filter((c) => can(actor, c));

  return (
    <CapabilityProvider caps={caps}>
    <div className="flex min-h-screen">
      <Sidebar actor={actor} boardsUnread={boardsUnread} teamPending={teamPending} />
      <main className="flex-1">
        {actor.preview && <PreviewBanner label={actor.preview.label} />}
        <div className="px-8 py-7">
        <div className="mx-auto max-w-6xl has-[[data-wide]]:max-w-[1500px]">
          <PageTransition>{children}</PageTransition>
        </div>
        </div>
      </main>
      <CommandPaletteLoader />
      {me && <TourHost actor={actor} />}
      {me && !me.hasCompletedOnboarding && (
        <Onboarding
          actor={actor}
          member={{ id: me.id, name: me.name, nickname: me.nickname, avatarUpdatedAt: me.avatarUpdatedAt?.toISOString() ?? null }}
          access={accessState(actor.rank, me.rankRequests[0] ?? null)}
        />
      )}
    </div>
    </CapabilityProvider>
  );
}
