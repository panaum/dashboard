import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Board } from "@/components/boards/board";
import { NewCardForm } from "@/components/boards/new-card-form";
import { BoardLinkControls } from "@/components/boards/board-link-controls";
import type { Card } from "@/components/boards/types";
import { isStage } from "@/lib/boards";
import {
  addComment, addImage, createCard, deleteCard, mintBoardLink, moveCard, revokeBoardLink, updateCard,
} from "../actions";

// QA's board for one project. Full fields, every move, the developer link.

export default async function ProjectBoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireAuth();
  const { projectId } = await params;
  const [project, members] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, name: true, boardShareId: true, client: { select: { name: true } },
        pages: {
          select: {
            id: true, name: true,
            issues: {
              where: { boardStage: { not: null } },
              select: {
                id: true, title: true, description: true, link: true, severity: true, recurring: true,
                boardStage: true, boardOrder: true, assigneeId: true, createdAt: true,
                assignee: { select: { name: true } }, reporter: { select: { name: true } },
                comments: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } },
                images: { orderBy: { createdAt: "asc" }, select: { id: true } },
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
    severity: i.severity, recurring: i.recurring, reporterName: i.reporter?.name ?? null,
    comments: i.comments.map((c) => ({ id: c.id, body: c.body, authorName: c.author?.name ?? null, createdAt: c.createdAt.toISOString() })),
    images: i.images,
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
        action={<NewCardForm projectId={project.id} pages={project.pages} members={members} onCreate={createCard} />}
      />
      <div className="mb-5">
        <BoardLinkControls
          boardShareId={project.boardShareId}
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
        onComment={addComment}
        onImage={addImage}
        onDelete={deleteCard}
      />
    </>
  );
}
