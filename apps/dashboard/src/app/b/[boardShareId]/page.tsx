import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Board } from "@/components/boards/board";
import type { Card } from "@/components/boards/types";
import { developerAuthorLabel, developerView, isStage } from "@/lib/boards";
import { developerComment, developerCover, developerDeleteImage, developerImage, developerMove } from "./actions";
import { participantsFor } from "@/lib/board-thread";

// The developer's board. Outside /dashboard, so no shell, no navbar, and
// nothing that says the rest of the app exists. The capability link is the
// only credential, and developerView() is the only shape a card leaves the
// server in: no severity, no recurring flag, no reporter. Priority is order.

export const metadata: Metadata = {
  title: "Board",
  robots: { index: false, follow: false },
};

export default async function DeveloperBoardPage({ params }: { params: Promise<{ boardShareId: string }> }) {
  const { boardShareId } = await params;
  const project = await db.project.findUnique({
    where: { boardShareId },
    select: {
      name: true,
      pages: {
        select: {
          issues: {
            where: { boardStage: { not: null } },
            select: {
              id: true, title: true, description: true, link: true,
              boardStage: true, boardOrder: true, assigneeId: true, reporterId: true, createdAt: true,
              assignee: { select: { name: true } },
              comments: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, authorId: true, author: { select: { name: true } } } },
              events: { orderBy: { createdAt: "asc" }, select: { id: true, fromStage: true, toStage: true, createdAt: true, actorId: true, actor: { select: { name: true } } } },
              images: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, isCover: true, bytes: true, createdAt: true } },
            },
          },
        },
      },
    },
  });
  if (!project) notFound();

  const cards: Card[] = project.pages.flatMap((pg) => pg.issues).flatMap((i) => {
    if (!isStage(i.boardStage)) return [];
    const safe = developerView({ ...i, boardStage: i.boardStage });
    return [{
      ...safe,
      createdAt: i.createdAt.toISOString(),
      assigneeName: i.assignee?.name ?? null,
      comments: i.comments.map((c) => ({ id: c.id, body: c.body, authorName: developerAuthorLabel({ authorId: c.authorId, authorName: c.author?.name ?? null }, i.assigneeId), createdAt: c.createdAt.toISOString() })),
      // Stage changes, with every non-assignee actor named "QA" — the same rule as the thread.
      events: i.events.flatMap((e) => isStage(e.toStage) ? [{
        id: e.id,
        actorName: developerAuthorLabel({ authorId: e.actorId, authorName: e.actor?.name ?? null }, i.assigneeId),
        fromStage: isStage(e.fromStage) ? e.fromStage : null, toStage: e.toStage, createdAt: e.createdAt.toISOString(),
      }] : []),
      images: i.images.map((img) => ({ ...img, createdAt: img.createdAt.toISOString() })),
      // Labels only. The reporter appears as "QA"; their id and name stay on the server.
      participants: participantsFor("developer", {
        reporterId: i.reporterId, reporterName: null, assigneeId: i.assigneeId, assigneeName: i.assignee?.name ?? null,
      }).map((p) => p.label),
    }];
  });

  return (
    <main className="min-h-screen bg-page px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[96rem]">
        <header className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Issue board</p>
          <h1 className="text-[24px] font-semibold tracking-tight text-text-primary">{project.name}</h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Work top to bottom within a column. Move a card to Completed when it is fixed; QA will verify and close it.
          </p>
        </header>
        <Board
          role="developer"
          cards={cards}
          imageBase={`/api/board-image?share=${boardShareId}`}
          onMove={async (input) => { "use server"; return developerMove({ boardShareId, ...input }); }}
          onComment={async (fd) => { "use server"; fd.set("boardShareId", boardShareId); return developerComment(fd); }}
          onImage={async (fd) => { "use server"; fd.set("boardShareId", boardShareId); return developerImage(fd); }}
          onCover={async (input) => { "use server"; return developerCover({ boardShareId, ...input }); }}
          onDeleteImage={async (input) => { "use server"; return developerDeleteImage({ boardShareId, ...input }); }}
        />
      </div>
    </main>
  );
}
