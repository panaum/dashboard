"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Inbox, MessageSquare, Paperclip, Plus, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_STAGES, BOARD_STAGE_LABELS, type BoardStage } from "@/lib/constants";
import { canMove, inStage, moveNeedsReason, type Role } from "@/lib/boards";
import { ReasonPrompt } from "./reason-prompt";
import { coverOf, initials } from "@/lib/board-thread";
import { agingLabel, agingLevel } from "@/lib/board-alive";
import { CountUp } from "./count-up";
import { playBoardChime, useBoardPulse, useSoundPreference } from "./use-pulse";
import { CardDialog, DueChip } from "./card-dialog";
import { prepareImage } from "./image-prep";
import type { Card, CommentResult, DatesInput, ImageResult, Member, MoveInput, Result } from "./types";

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
  onDeleteComment,
  onDates,
  onDelete,
  viewerName,
  viewerId,
  projectId,
  boardShareId,
  onMarkViewed,
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
  onImage: (fd: FormData) => Promise<ImageResult>;
  onCover: (input: { issueId: string; imageId: string | null }) => Promise<Result>;
  onDeleteImage: (input: { issueId: string; imageId: string }) => Promise<Result>;
  onDeleteComment: (input: { id: string }) => Promise<Result>;
  onDates?: (input: DatesInput) => Promise<Result>;
  onDelete?: (input: { id: string }) => Promise<Result>;
  /** QA page: the signed-in person's name, or null on the shared team login. */
  viewerName?: string | null;
  /** The viewer's TeamMember id, when they are a person: used to notice a card
   *  that has just become theirs, and to leave themselves out of presence. */
  viewerId?: string | null;
  /** One of these identifies the board to the pulse endpoint. */
  projectId?: string;
  boardShareId?: string;
  onMarkViewed: (input: { issueId: string }) => Promise<Result>;
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
  const [asking, setAsking] = useState<{ id: string; to: BoardStage; index: number; title: string } | null>(null);

  const [soundOn, setSoundOn] = useSoundPreference();

  // Presence, typing, "has anything changed", and "somebody else just did
  // something" all come from one poll. onNews is re-read each render, so
  // flipping the switch takes effect without restarting the heartbeat.
  const { present, typingLine, setOpenIssue, setTyping } = useBoardPulse({
    projectId,
    boardShareId,
    viewerId,
    onNews: () => { if (soundOn) playBoardChime(); },
  });
  const presentIds = new Set(present.map((p) => p.memberId));

  // A card that has just moved settles; one that has just landed in Closed
  // pulses once. Both are derived by comparing renders, so neither needs a
  // remount — remounting a card would close a dialog somebody had open.
  const stages = useRef(new Map(cards.map((c) => [c.id, c.boardStage])));
  const [settling, setSettling] = useState<Record<string, "move" | "closed">>({});
  useEffect(() => {
    const next: Record<string, "move" | "closed"> = {};
    for (const c of cards) {
      const before = stages.current.get(c.id);
      if (before && before !== c.boardStage) next[c.id] = c.boardStage === "CLOSED" ? "closed" : "move";
    }
    stages.current = new Map(cards.map((c) => [c.id, c.boardStage]));
    if (Object.keys(next).length === 0) return;
    setSettling((s) => ({ ...s, ...next }));
    const t = setTimeout(() => setSettling({}), 700);
    return () => clearTimeout(t);
  }, [cards]);

  const byId = useRef(new Map(cards.map((c) => [c.id, c])));
  byId.current = new Map(cards.map((c) => [c.id, c]));

  const allowed = useCallback(
    (id: string, to: BoardStage) => {
      const card = byId.current.get(id);
      if (!card) return false;
      return card.boardStage === to || canMove(role, card.boardStage, to);
    },
    [role],
  );

  const send = (id: string, to: BoardStage, index: number, reason?: string) =>
    start(async () => {
      const r = await onMove({ id, to, index, reason });
      if (r.error) setError(r.error);
    });

  const drop = (id: string, to: BoardStage, index: number) => {
    setDragging(null); setOver(null); setError(null);
    if (!allowed(id, to)) { setError("That move is not allowed."); return; }
    // Discussed is the one column you have to explain yourself into, so the
    // card waits on the answer rather than moving and asking afterwards.
    if (moveNeedsReason(to, byId.current.get(id)?.boardStage ?? null)) {
      setAsking({ id, to, index, title: byId.current.get(id)?.title ?? "this card" });
      return;
    }
    send(id, to, index);
  };

  return (
    <div className="flex flex-col gap-3">
      {asking && (
        <ReasonPrompt
          stageLabel={BOARD_STAGE_LABELS[asking.to]}
          cardTitle={asking.title}
          onCancel={() => setAsking(null)}
          onSubmit={(reason) => {
            const a = asking;
            setAsking(null);
            send(a.id, a.to, a.index, reason);
          }}
        />
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-error/[0.11] px-4 py-2 text-[13px] text-error-strong">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-h-6 items-center gap-1.5" aria-live="polite">
          {present.length > 0 && (
            <>
              <span className="text-[11px] text-text-secondary">Here now</span>
              {present.slice(0, 5).map((p) => (
                <span
                  key={p.memberId}
                  title={`${p.name} has this board open`}
                  className="flex size-5 items-center justify-center rounded-full bg-success/[0.16] text-[9px] font-semibold text-success-strong ring-1 ring-success/30"
                >
                  {initials(p.name)}
                </span>
              ))}
              {present.length > 5 && <span className="text-[11px] text-text-secondary">+{present.length - 5}</span>}
            </>
          )}
        </div>
        {/* Offered only to someone the board can name. On a developer link the
            viewer is anonymous by design, so their own move cannot be told
            from anybody else's — and a chime that answers your own clicks is
            worse than no chime. Same limitation as presence, same reason. */}
        {viewerId && (
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              // Ring once on the way on. Two jobs: you hear what you just
              // switched on instead of trusting a label, and the click itself
              // is the gesture that lets the browser play audio later.
              if (next) playBoardChime();
            }}
            aria-pressed={soundOn}
            title={
              soundOn
                ? "Sound on — a chime when somebody else moves a card or comments"
                : "Sound off — turn it on to hear when somebody else moves a card or comments"
            }
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            {soundOn ? "Sound on" : "Sound off"}
          </button>
        )}
      </div>
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
                <span className="text-[11px] tabular-nums text-text-secondary"><CountUp value={column.length} /></span>
              </h3>
              <ol className="flex flex-col gap-2">
                {column.map((card, index) => {
                  const cover = coverOf(card.images);
                  const aging = agingLevel(card.stageSince, card.boardStage, new Date());
                  const settle = settling[card.id];
                  return (
                    <li
                      key={card.id}
                      draggable
                      onDragStart={(e) => { setDragging(card.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver({ stage, index }); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragging) drop(dragging, stage, index); }}
                      title={card.stageSince ? agingLabel(card.stageSince, BOARD_STAGE_LABELS[card.boardStage], new Date()) : undefined}
                      className={cn(
                        "relative overflow-hidden rounded-lg bg-card transition-[transform,box-shadow,opacity] duration-150 ease-out",
                        // Lift: the card being dragged rises off the column.
                        dragging === card.id && "scale-[1.03] opacity-60 shadow-lg",
                        over?.stage === stage && over.index === index && dragging && dragging !== card.id && "ring-2 ring-accent",
                        // Unread is a ring, not a left border: the left edge is
                        // already the severity strip on the QA view.
                        card.unread && "ring-1 ring-inset ring-accent/45",
                        // Aging: a faint amber that deepens the longer a card
                        // sits in one stage. Never on Completed or Closed.
                        aging === 1 && "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-warning)_35%,transparent)]",
                        aging === 2 && "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-warning)_60%,transparent)]",
                        aging === 3 && "shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-warning)_80%,transparent)]",
                      )}
                      style={settle === "closed"
                        ? { animation: "closed-pulse 600ms ease-out" }
                        : settle === "move"
                          ? { animation: "card-settle 420ms cubic-bezier(.34,1.56,.64,1)" }
                          : undefined}
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
                          onSave={onSave} onPatch={onPatch} onComment={onComment} onImage={onImage} onCover={onCover} onDeleteImage={onDeleteImage} onDeleteComment={onDeleteComment} onDates={onDates} viewerName={viewerName}
                          onMarkViewed={onMarkViewed} onOpen={setOpenIssue} onTyping={setTyping} typingLine={typingLine}
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
                            <span className="relative shrink-0">
                              <span
                                className="flex size-6 items-center justify-center rounded-full bg-accent/[0.14] text-[10px] font-semibold text-accent"
                                title={card.assigneeName} aria-label={`Assigned to ${card.assigneeName}`}
                              >
                                {initials(card.assigneeName)}
                              </span>
                              {card.assigneeId && presentIds.has(card.assigneeId) && (
                                <span
                                  className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-card"
                                  title={`${card.assigneeName} has this board open`}
                                  aria-label={`${card.assigneeName} is here`}
                                />
                              )}
                            </span>
                          )}
                        </div>
                        <MoveMenu card={card} role={role} onMove={(to) => drop(card.id, to, 9999)} />
                      </div>
                    </li>
                  );
                })}
              </ol>
              {column.length === 0 && (
                <div className="flex flex-col items-center gap-1 px-2 py-6 text-center">
                  <Inbox className="size-5 text-text-muted/50" strokeWidth={1.5} aria-hidden />
                  <span className="text-[11px] text-text-muted">Nothing here yet</span>
                </div>
              )}
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
  const targets = BOARD_STAGES.filter((s) => canMove(role, card.boardStage, s));
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
  // The name the person pasted, kept for the card's title: the stored file is
  // re-encoded to .webp, and a card called "screenshot.webp" reads like a
  // machine named it.
  const [shotName, setShotName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!shot) { setPreview(null); return; }
    const url = URL.createObjectURL(shot); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  // `name` is passed explicitly by the paste path: it submits from inside a
  // promise, where the captured shotName is still the value from the render
  // that started the paste (null).
  const submit = (file: File | null, name?: string | null) => {
    const form = formRef.current; if (!form) return;
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    if (!title && !file) return;
    if (!title) fd.set("title", name || shotName || file!.name || "Screenshot");
    if (file) fd.set("image", file, file.name || "screenshot.png");
    fd.set("projectId", projectId); if (pages.length === 1) fd.set("pageId", pages[0].id); fd.set("severity", "MEDIUM");
    if (!fd.get("pageId")) { setError("Choose the page this issue is on."); return; }
    start(async () => {
      setError(null); const r = await onCreate(fd);
      if (r.error) setError(r.error); else { form.reset(); setShot(null); setShotName(null); setOpen(false); if (r.id) onAdded(r.id); }
    });
  };
  const takeImage = (files: FileList | File[] | null | undefined) => {
    const f = Array.from(files ?? []).find((x) => x.type.startsWith("image/"));
    if (!f) return false;
    setShot(f); // show the preview at once; the re-encode takes a moment
    setShotName(f.name);
    void prepareImage(f).then((ready) => {
      setShot(ready);
      if (pages.length === 1) submit(ready, f.name); // one page: the paste is the submit
    });
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
            <button type="button" onClick={() => { setShot(null); setShotName(null); }} aria-label="Remove screenshot"
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/45 p-1 text-white hover:bg-black/60"><X className="size-3.5" /></button>
          )}
          <p className="truncate px-2 py-1 text-[11px] text-text-secondary">{pending ? "Adding card…" : `${shotName || shot?.name || "Screenshot"} · becomes the cover`}</p>
        </div>
      )}
      <textarea name="title" maxLength={200} rows={2} autoFocus placeholder="Enter a title or paste a screenshot…"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(shot); } if (e.key === "Escape") { setShot(null); setShotName(null); setOpen(false); } }}
                className="w-full resize-none rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary shadow-xs placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent" />
      {pages.length > 1 && (
        <select name="pageId" required defaultValue="" aria-label="Page" className="w-full rounded-lg border border-border-soft bg-card px-2.5 py-1.5 text-[12px] text-text-primary">
          <option value="" disabled>Which page is it on?</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={pending}>Add card</Button>
        <button type="button" onClick={() => { setShot(null); setShotName(null); setOpen(false); }} aria-label="Cancel" className="rounded-md p-1.5 text-text-secondary hover:bg-card hover:text-text-primary"><X className="size-4" /></button>
      </div>
    </form>
  );
}
