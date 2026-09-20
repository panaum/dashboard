import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Board } from "@/components/boards/board";
import { BoardLinkControls } from "@/components/boards/board-link-controls";
import type { Card } from "@/components/boards/types";
import { isStage } from "@/lib/boards";
import { mentionLabelsFor } from "@/lib/board-thread";
import {
  addComment, addImage, createCard, deleteCard, deleteComment, deleteImage, mintBoardLink, moveCard, patchCard, revokeBoardLink, setCover, setDates, updateCard,
} from "../actions";

// QA's board for one project. Full fields, every move, the developer link.

export default async function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAuth();
  const { projectId } = await params;
  const [project, members] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, name: true, boardShareId: true, boardShareCreatedAt: true,
        boardShareCreatedBy: { select: { name: true } }, client: { select: { name: true } },
        pages: {
          select: {
            id: true, name: true,
            issues: {
              where: { boardStage: { not: null } },
              select: {
                id: true, title: true, description: true, link: true, severity: true, recurring: true,
                boardStage: true, boardOrder: true, assigneeId: true, reporterId: true, createdAt: true, startAt: true, dueAt: true, dueReminderMinutes: true,
                assignee: { select: { name: true } }, reporter: { select: { name: true } },
                comments: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } },
                events: { orderBy: { createdAt: "asc" }, select: { id: true, fromStage: true, toStage: true, createdAt: true, actor: { select: { name: true } } } },
                images: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, isCover: true, bytes: true, createdAt: true } },
              },
            },
          },
        },
      },
    }),
    db.teamMember.findMany({ where: { active: true, role: { in: ["DEVELOPER", "BOTH"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!project) notFound();

  const cards: Card[] = project.pages.flatMap((pg) => pg.issues).flatMap((i) => isStage(i.boardStage) ? [{
    id: i.id, title: i.title, description: i.description, link: i.link,
    boardStage: i.boardStage, boardOrder: i.boardOrder,
    assigneeId: i.assigneeId, assigneeName: i.assignee?.name ?? null,
    createdAt: i.createdAt.toISOString(),
    startAt: i.startAt?.toISOString() ?? null, dueAt: i.dueAt?.toISOString() ?? null, dueReminderMinutes: i.dueReminderMinutes,
    severity: i.severity, recurring: i.recurring, reporterName: i.reporter?.name ?? null,
    comments: i.comments.map((c) => ({ id: c.id, body: c.body, authorName: c.author?.name ?? null, createdAt: c.createdAt.toISOString(), deletable: true })),
    events: i.events.flatMap((e) => isStage(e.toStage) ? [{
      id: e.id, actorName: e.actor?.name ?? null, fromStage: isStage(e.fromStage) ? e.fromStage : null, toStage: e.toStage, createdAt: e.createdAt.toISOString(),
    }] : []),
    images: i.images.map((img) => ({ ...img, createdAt: img.createdAt.toISOString() })),
    participants: mentionLabelsFor("qa", {
      reporterId: i.reporterId, reporterName: i.reporter?.name ?? null, assigneeId: i.assigneeId, assigneeName: i.assignee?.name ?? null,
    }, actor.id),
  }] : []);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;

  return (
    <>
      <Link href="/dashboard/boards" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> All boards
      </Link>
      <PageHeader
        title={project.name}
        subtitle={`${project.client.name} · ${cards.filter((c) => c.boardStage !== "CLOSED").length} open`}
      />
      <div className="mb-5">
        <BoardLinkControls
          boardShareId={project.boardShareId}
          createdBy={project.boardShareCreatedBy?.name ?? null}
          createdAt={project.boardShareCreatedAt ? mintedOn(project.boardShareCreatedAt) : null}
          origin={origin}
          onMint={async () => { "use server"; return mintBoardLink({ projectId }); }}
          onRevoke={async () => { "use server"; return revokeBoardLink({ projectId }); }}
        />
      </div>
      <Board
        role="qa"
        cards={cards}
        members={members}
        imageBase="/api/board-image"
        onMove={moveCard}
        onSave={updateCard}
        onPatch={patchCard}
        onComment={addComment}
        onImage={addImage}
        onCover={setCover}
        onDates={setDates}
        viewerName={actor.bootstrap ? null : actor.name}
        onDeleteImage={deleteImage}
        onDeleteComment={deleteComment}
        onDelete={deleteCard}
        quickAdd={{ projectId: project.id, pages: project.pages }}
        onCreate={createCard}
      />
    </>
  );
}

/** "20 Sep 2026" — en-US month parts, since en-GB abbreviates September as "Sept". */
function mintedOn(d: Date): string {
  const part = (opts: Intl.DateTimeFormatOptions, type: string) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).formatToParts(d).find((p) => p.type === type)?.value ?? "";
  return `${part({ day: "numeric" }, "day")} ${part({ month: "short" }, "month")} ${part({ year: "numeric" }, "year")}`;
}
