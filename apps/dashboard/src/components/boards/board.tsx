"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { MessageSquare, Paperclip, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_STAGES, BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { canMove, inStage, type Role } from "@/lib/boards";
import { coverOf, initials } from "@/lib/board-thread";
import { CardDialog, DueChip } from "./card-dialog";
import type { Card, CommentResult, DatesInput, Member, MoveInput, Result } from "./types";

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
  onDeleteImage,
  onDates,
  onDelete,
  quickAdd,
  onCreate,
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
  onDeleteImage: (input: { issueId: string; imageId: string }) => Promise<Result>;
  onDates?: (input: DatesInput) => Promise<Result>;
  onDelete?: (input: { id: string }) => Promise<Result>;
  /** QA only: "+ Add a card" at the foot of New — a title (and the page, when
   *  the project has more than one) and nothing else; details on the card. */
  quickAdd?: { projectId: string; pages: { id: string; name: string }[] };
  onCreate?: (fd: FormData) => Promise<Result & { id?: string }>;
}) {
  const imageSrc = (id: string) => `${imageBase}${imageBase.includes("?") ? "&" : "?"}id=${id}`;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: BoardStage; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The card just added opens itself — Trello's "+ Add a card" is the only
  // way in, and everything else is set on the card's back.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Consume the mark as soon as the card has rendered once. Its dialog keeps
  // the open state it started with; without this, every later move of that
  // card re-creates its element in another column and it would open again.
  useEffect(() => {
    if (justAdded && cards.some((c) => c.id === justAdded)) {
      const t = setTimeout(() => setJustAdded(null), 0);
      return () => clearTimeout(t);
    }
  }, [justAdded, cards]);
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
                          initialOpen={card.id === justAdded}
                          onMove={(to) => drop(card.id, to, 9999)}
                          onSave={onSave} onPatch={onPatch} onComment={onComment} onImage={onImage} onCover={onCover} onDeleteImage={onDeleteImage} onDates={onDates}
                          onDelete={onDelete ? () => onDelete({ id: card.id }) : undefined}
                        />
                        {/* Icon row: counts on the left, the assignee's initials on the right. */}
                        <div className="flex items-end justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-secondary">
                            {(card.dueAt || card.startAt) && <DueChip card={card} />}
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
              {stage === "NEW" && quickAdd && onCreate && (
                <QuickAdd projectId={quickAdd.projectId} pages={quickAdd.pages} onCreate={onCreate} onAdded={setJustAdded} />
              )}
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


/** The reference's "+ Add a card": a title, Enter, done. Severity defaults to
 *  medium and the card is unassigned; both are set from the card back. */
function QuickAdd({ projectId, pages, onCreate, onAdded }: {
  projectId: string; pages: { id: string; name: string }[];
  onCreate: (fd: FormData) => Promise<Result & { id?: string }>; onAdded: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A screenshot pasted (or dropped) into the box IS the submit, as in the
  // reference: the card is made on the spot with the image as its cover and
  // the file's name as the title, and it opens itself. Only when the project
  // has several pages does the image wait, as a preview, for the page pick.
  const [shot, setShot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!shot) { setPreview(null); return; }
    const url = URL.createObjectURL(shot); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  const submit = (file: File | null) => {
    const form = formRef.current; if (!form) return;
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    if (!title && !file) return;
    if (!title) fd.set("title", file!.name || "Screenshot");
    if (file) fd.set("image", file, file.name || "screenshot.png");
    fd.set("projectId", projectId); if (pages.length === 1) fd.set("pageId", pages[0].id); fd.set("severity", "MEDIUM");
    if (!fd.get("pageId")) { setError("Choose the page this issue is on."); return; }
    start(async () => {
      setError(null); const r = await onCreate(fd);
      if (r.error) setError(r.error); else { form.reset(); setShot(null); setOpen(false); if (r.id) onAdded(r.id); }
    });
  };
  const takeImage = (files: FileList | File[] | null | undefined) => {
    const f = Array.from(files ?? []).find((x) => x.type.startsWith("image/"));
    if (!f) return false;
    setShot(f);
    if (pages.length === 1) submit(f); // one page: the paste is the submit
    return true;
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-text-secondary hover:bg-card hover:text-text-primary">
        <Plus className="size-4" /> Add a card
      </button>
    );
  }
  return (
    <form
      ref={formRef}
      className="mt-1 grid gap-2"
      aria-busy={pending}
      onPaste={(e) => { if (takeImage(e.clipboardData.files)) e.preventDefault(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); takeImage(e.dataTransfer.files); }}
      onSubmit={(e) => { e.preventDefault(); submit(shot); }}
    >
      {error && <p role="alert" className="rounded-lg bg-error/[0.11] px-3 py-2 text-[12px] text-error-strong">{error}</p>}
      {preview && (
        <div className="relative overflow-hidden rounded-lg bg-card ring-1 ring-inset ring-border-soft">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-40 w-full object-cover" data-testid="pasted-preview" />
          {!pending && (
            <button type="button" onClick={() => setShot(null)} aria-label="Remove screenshot"
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/45 p-1 text-white hover:bg-black/60"><X className="size-3.5" /></button>
          )}
          <p className="truncate px-2 py-1 text-[11px] text-text-secondary">{pending ? "Adding card…" : `${shot?.name || "Screenshot"} · becomes the cover`}</p>
        </div>
      )}
      <textarea name="title" maxLength={200} rows={2} autoFocus placeholder="Enter a title or paste a screenshot…"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(shot); } if (e.key === "Escape") { setShot(null); setOpen(false); } }}
                className="w-full resize-none rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary shadow-xs placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent" />
      {pages.length > 1 && (
        <select name="pageId" required defaultValue="" aria-label="Page" className="w-full rounded-lg border border-border-soft bg-card px-2.5 py-1.5 text-[12px] text-text-primary">
          <option value="" disabled>Which page is it on?</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={pending}>Add card</Button>
        <button type="button" onClick={() => { setShot(null); setOpen(false); }} aria-label="Cancel" className="rounded-md p-1.5 text-text-secondary hover:bg-card hover:text-text-primary"><X className="size-4" /></button>
      </div>
    </form>
  );
}
