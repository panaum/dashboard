"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { MessageSquare, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOARD_STAGES, BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { canMove, inStage, type Role } from "@/lib/boards";
import { coverOf, initials } from "@/lib/board-thread";
import { CardDialog } from "./card-dialog";
import type { Card, CommentResult, Member, MoveInput, Result } from "./types";

// One board for two readers. QA and the developer see the same columns and
// the same cards; the role decides which moves are offered and which fields
// were ever sent. Priority reaches the developer as ORDER within a column —
// no label, no colour — so the columns are the whole interface.
//
// Drag-and-drop is native HTML5: no dependency, and the keyboard path is the
// same handler with a stage picker, so a developer without a mouse can still
// hand a card to QA.

const SEVERITY_EDGE: Record<string, string> = {
  CRITICAL_HIGH: "bg-error",
  MEDIUM: "bg-warning",
  LOW: "bg-text-muted",
  REPETITIVE: "bg-info",
};

export function Board({
  role,
  cards,
  members = [],
  imageBase,
  onMove,
  onSave,
  onPatch,
  onComment,
  onImage,
  onCover,
  onDelete,
}: {
  role: Role;
  cards: Card[];
  /** Assignable developers. QA only; the developer view passes none. */
  members?: Member[];
  /** Image URL prefix — the developer's carries the board token as a query. */
  imageBase: string;
  // Every function here is a server action. A plain function cannot cross
  // from a server component into this one, which is why the dialog is
  // rendered HERE rather than handed in as a render prop.
  onMove: (input: MoveInput) => Promise<Result>;
  onSave?: (fd: FormData) => Promise<Result>;
  onPatch?: (fd: FormData) => Promise<Result>;
  onComment: (fd: FormData) => Promise<CommentResult>;
  onImage: (fd: FormData) => Promise<Result>;
  onCover: (input: { issueId: string; imageId: string | null }) => Promise<Result>;
  onDelete?: (input: { id: string }) => Promise<Result>;
}) {
  const imageSrc = (id: string) => `${imageBase}${imageBase.includes("?") ? "&" : "?"}id=${id}`;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: BoardStage; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = useRef(new Map(cards.map((c) => [c.id, c])));
  byId.current = new Map(cards.map((c) => [c.id, c]));

  const allowed = useCallback(
    (id: string, to: BoardStage) => {
      const card = byId.current.get(id);
      if (!card) return false;
      return card.boardStage === to || canMove(role, card.boardStage, to, { assigned: !!card.assigneeId });
    },
    [role],
  );

  const drop = (id: string, to: BoardStage, index: number) => {
    setDragging(null); setOver(null); setError(null);
    if (!allowed(id, to)) { setError(role === "qa" ? "That move is not allowed." : "That move is QA's to make."); return; }
    start(async () => {
      const r = await onMove({ id, to, index });
      if (r.error) setError(r.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-lg bg-error/[0.11] px-4 py-2 text-[13px] text-error-strong">
          {error}
        </p>
      )}
      <div
        className={cn("grid gap-3 md:grid-cols-5", pending && "opacity-70 transition-opacity")}
        aria-busy={pending}
      >
        {BOARD_STAGES.map((stage) => {
          const column = inStage(cards, stage);
          return (
            <section
              key={stage}
              aria-labelledby={`stage-${stage}`}
              className={cn(
                "flex min-h-[12rem] flex-col gap-2 rounded-xl bg-card-soft p-2 transition-colors",
                over?.stage === stage && dragging && allowed(dragging, stage) && "bg-accent/[0.08]",
                over?.stage === stage && dragging && !allowed(dragging, stage) && "bg-error/[0.08]",
              )}
              onDragOver={(e) => { e.preventDefault(); if (over?.stage !== stage) setOver({ stage, index: column.length }); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); if (dragging) drop(dragging, stage, over?.index ?? column.length); }}
            >
              <h3 id={`stage-${stage}`} className="flex items-baseline justify-between px-2 pt-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                  {BOARD_STAGE_LABELS[stage]}
                </span>
                <span className="text-[11px] tabular-nums text-text-secondary">{column.length}</span>
              </h3>
              <ol className="flex flex-col gap-2">
                {column.map((card, index) => {
                  const cover = coverOf(card.images);
                  return (
                    <li
                      key={card.id}
                      draggable
                      onDragStart={(e) => { setDragging(card.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver({ stage, index }); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragging) drop(dragging, stage, index); }}
                      className={cn(
                        "relative overflow-hidden rounded-lg bg-card transition-colors",
                        dragging === card.id && "opacity-40",
                        over?.stage === stage && over.index === index && dragging && dragging !== card.id && "ring-2 ring-accent",
                      )}
                    >
                      {/* The severity edge exists only where severity was sent. */}
                      {card.severity && (
                        <span className={cn("absolute inset-y-0 left-0 z-10 w-[3px]", SEVERITY_EDGE[card.severity] ?? "bg-text-muted")} aria-hidden />
                      )}
                      {/* Cover: the image flagged as such fills the top of the card. */}
                      {cover && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageSrc(cover.id)} alt="" className="h-24 w-full object-cover" draggable={false} />
                      )}
                      <div className="flex flex-col gap-1.5 py-2.5 pl-4 pr-3">
                        <CardDialog
                          role={role} card={card} members={members} imageSrc={imageSrc}
                          onMove={(to) => drop(card.id, to, 9999)}
                          onSave={onSave} onPatch={onPatch} onComment={onComment} onImage={onImage} onCover={onCover}
                          onDelete={onDelete ? () => onDelete({ id: card.id }) : undefined}
                        />
                        {/* Icon row: counts on the left, the assignee's initials on the right. */}
                        <div className="flex items-end justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-secondary">
                            {card.images.length > 0 && (
                              <span className="inline-flex items-center gap-1" title={`${card.images.length} attachment${card.images.length === 1 ? "" : "s"}`}>
                                <Paperclip className="size-3.5" strokeWidth={1.75} aria-hidden />
                                <span className="tabular-nums">{card.images.length}</span>
                                <span className="sr-only">attachments</span>
                              </span>
                            )}
                            {card.comments.length > 0 && (
                              <span className="inline-flex items-center gap-1" title={`${card.comments.length} comment${card.comments.length === 1 ? "" : "s"}`}>
                                <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
                                <span className="tabular-nums">{card.comments.length}</span>
                                <span className="sr-only">comments</span>
                              </span>
                            )}
                            {card.recurring && <span className="rounded bg-info/[0.16] px-1.5 py-0.5 text-text-primary">recurring</span>}
                          </div>
                          {card.assigneeName && (
                            <span
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/[0.14] text-[10px] font-semibold text-accent"
                              title={card.assigneeName} aria-label={`Assigned to ${card.assigneeName}`}
                            >
                              {initials(card.assigneeName)}
                            </span>
                          )}
                        </div>
                        <MoveMenu card={card} role={role} onMove={(to) => drop(card.id, to, 9999)} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** The keyboard path: the same move, as a labelled select. */
function MoveMenu({ card, role, onMove }: { card: Card; role: Role; onMove: (to: BoardStage) => void }) {
  const targets = BOARD_STAGES.filter((s) => canMove(role, card.boardStage, s, { assigned: !!card.assigneeId }));
  if (!targets.length) return null;
  return (
    <label className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
      <span className="sr-only">Move {card.title} to</span>
      <select
        aria-label={`Move "${card.title}" to`}
        value=""
        onChange={(e) => e.target.value && onMove(e.target.value as BoardStage)}
        className="rounded border border-border-soft bg-card px-1.5 py-0.5 text-[11px] text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <option value="">Move to…</option>
        {targets.map((s) => <option key={s} value={s}>{BOARD_STAGE_LABELS[s]}</option>)}
      </select>
    </label>
  );
}
