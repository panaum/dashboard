"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BOARD_STAGES, BOARD_STAGE_LABELS, SEVERITIES, type BoardStage } from "@/lib/constants";
import { canMove, type Role } from "@/lib/boards";
import { activityFeed, coverOf, formatWhen, initials } from "@/lib/board-thread";
import type { Card, CommentResult, Member, Result } from "./types";

// The card, opened. Top to bottom: the cover (only if one is flagged), the
// stage — a select that fires the SAME move as a drag, so it writes the same
// IssueEvent — the title and description edited in place, QA's details,
// attachments with the cover control, and one feed of comments and stage
// changes in time order. Severity, the recurring flag and the reporter are
// not hidden here for the developer — they were never in the props.

export function CardDialog({
  role, card, members, imageSrc, onMove, onSave, onPatch, onComment, onImage, onCover, onDelete,
}: {
  role: Role;
  card: Card;
  members: Member[];
  /** URL for an image id — the developer's carries the board token. */
  imageSrc: (id: string) => string;
  onMove: (to: BoardStage) => void;
  onSave?: (fd: FormData) => Promise<Result>;
  onPatch?: (fd: FormData) => Promise<Result>;
  onComment: (fd: FormData) => Promise<CommentResult>;
  onImage: (fd: FormData) => Promise<Result>;
  onCover: (input: { issueId: string; imageId: string | null }) => Promise<Result>;
  onDelete?: () => Promise<Result>;
}) {
  return (
    <Dialog
      size="lg"
      title={card.title}
      trigger={
        <button type="button" className="text-left text-[13px] font-medium leading-snug text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {card.title}
        </button>
      }
    >
      {(close) => (
        <Body role={role} card={card} members={members} imageSrc={imageSrc} onMove={onMove}
              onSave={onSave} onPatch={onPatch} onComment={onComment} onImage={onImage} onCover={onCover} onDelete={onDelete} close={close} />
      )}
    </Dialog>
  );
}

const field = "w-full rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary";

function Body({ role, card, members, imageSrc, onMove, onSave, onPatch, onComment, onImage, onCover, onDelete, close }: {
  role: Role; card: Card; members: Member[]; imageSrc: (id: string) => string; onMove: (to: BoardStage) => void;
  onSave?: (fd: FormData) => Promise<Result>; onPatch?: (fd: FormData) => Promise<Result>;
  onComment: (fd: FormData) => Promise<CommentResult>; onImage: (fd: FormData) => Promise<Result>;
  onCover: (input: { issueId: string; imageId: string | null }) => Promise<Result>;
  onDelete?: () => Promise<Result>; close: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, then?: () => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.error) setError(r.error); else then?.(); });

  const cover = coverOf(card.images);
  const stages = BOARD_STAGES.filter((s) => s === card.boardStage || canMove(role, card.boardStage, s, { assigned: !!card.assigneeId }));
  const canEdit = role === "qa" && !!onPatch;
  const patch = (key: "title" | "description", value: string) => {
    if (!onPatch) return;
    const current = key === "title" ? card.title : (card.description ?? "");
    if (value.trim() === current.trim()) return;
    const fd = new FormData(); fd.set("id", card.id); fd.set(key, value);
    run(() => onPatch(fd));
  };
  const feed = activityFeed(card.comments, card.events);
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      {error && <p role="alert" className="rounded-lg bg-error/[0.11] px-3 py-2 text-error-strong">{error}</p>}

      {/* 1. Cover — only when one is flagged; no empty block otherwise. */}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc(cover.id)} alt="" className="-mt-1 max-h-56 w-full rounded-lg object-cover ring-1 ring-inset ring-border-soft" />
      )}

      {/* 2. Stage — the same write as a drag. */}
      <label className="flex w-fit items-center gap-2">
        <span className={label}>Stage</span>
        <select
          aria-label="Stage"
          value={card.boardStage}
          disabled={stages.length < 2}
          onChange={(e) => { const to = e.target.value as BoardStage; if (to !== card.boardStage) onMove(to); }}
          className="rounded-lg border border-border-soft bg-card px-2.5 py-1.5 text-[13px] font-medium text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-70"
        >
          {stages.map((s) => <option key={s} value={s}>{BOARD_STAGE_LABELS[s]}</option>)}
        </select>
      </label>

      {/* 3. Title, 4. Description — in place for QA, read-only for the developer. */}
      {canEdit ? (
        <div className="grid gap-2">
          <input
            aria-label="Title" defaultValue={card.title} required maxLength={200}
            onBlur={(e) => patch("title", e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold tracking-tight text-text-primary hover:border-border-soft focus-visible:border-border-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
          <textarea
            aria-label="Description" defaultValue={card.description ?? ""} rows={3} maxLength={4000}
            placeholder="Add a more detailed description…"
            onBlur={(e) => patch("description", e.target.value)}
            className="w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1 text-text-primary placeholder:text-text-muted hover:border-border-soft focus-visible:border-border-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <h3 className="text-[17px] font-semibold tracking-tight text-text-primary">{card.title}</h3>
          {card.description
            ? <p className="whitespace-pre-wrap text-text-primary">{card.description}</p>
            : <p className="text-text-muted">No description yet.</p>}
        </div>
      )}
      {card.link && (
        <a href={card.link} target="_blank" rel="noopener" className="-mt-2 w-fit text-accent hover:underline">{card.link}</a>
      )}

      {/* QA's details: what the developer never receives. */}
      {role === "qa" && onSave && (
        <details className="rounded-lg border border-border-soft">
          <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-text-secondary">
            Details — {card.severity?.replace("_", " / ").toLowerCase()}, {card.assigneeName ?? "unassigned"}{card.recurring ? ", recurring" : ""}
          </summary>
          <form
            className="grid gap-3 border-t border-border-soft p-3"
            onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", card.id); fd.set("title", card.title); fd.set("description", card.description ?? ""); run(() => onSave(fd)); }}
          >
            <label className="grid gap-1"><span className={label}>Link</span>
              <input name="link" defaultValue={card.link ?? ""} placeholder="https://" className={field} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1"><span className={label}>Severity</span>
                <select name="severity" defaultValue={card.severity} className={field}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s.replace("_", " / ").toLowerCase()}</option>)}
                </select></label>
              <label className="grid gap-1"><span className={label}>Assignee</span>
                <select name="assigneeId" defaultValue={card.assigneeId ?? ""} className={field}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" name="recurring" value="true" defaultChecked={card.recurring} className="size-4 accent-accent" />
                <span className="text-text-primary">Recurring</span></label>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">
                Logged {card.createdAt.slice(0, 10)}{card.reporterName ? ` by ${card.reporterName}` : ""}
              </span>
              <div className="flex gap-2">
                {onDelete && (
                  <Button type="button" variant="ghost" disabled={pending}
                          onClick={() => { if (confirm("Delete this card?")) run(onDelete, close); }}>Delete</Button>
                )}
                <Button type="submit" disabled={pending}>Save</Button>
              </div>
            </div>
          </form>
        </details>
      )}

      {/* 5. Attachments */}
      <section className="grid gap-2">
        <h4 className={label}>Attachments</h4>
        {card.images.length > 0 && (
          <ul className="grid gap-1.5">
            {card.images.map((img) => (
              <li key={img.id} className="flex items-center gap-3 rounded-lg bg-card-soft px-2 py-1.5">
                <a href={imageSrc(img.id)} target="_blank" rel="noopener" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageSrc(img.id)} alt="" className="size-12 rounded-md object-cover ring-1 ring-inset ring-border-soft" />
                </a>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text-primary">{img.filename ?? "Image"}</p>
                  <p className="text-[11px] text-text-secondary">{formatWhen(img.createdAt, tz)} · {Math.max(1, Math.round(img.bytes / 1024))} KB</p>
                </div>
                {img.isCover ? (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => onCover({ issueId: card.id, imageId: null }))}>
                    Remove cover
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => onCover({ issueId: card.id, imageId: img.id }))}>
                    Make cover
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); fd.set("issueId", card.id); run(() => onImage(fd), () => f.reset()); }}
        >
          <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" required className="min-w-0 max-w-full text-[12px] text-text-secondary" />
          <Button type="submit" variant="ghost" disabled={pending}>Upload</Button>
        </form>
      </section>

      {/* 6. Comments and activity — one feed. Stage changes are the system
          lines; no activity table, IssueEvent already is one. */}
      <section className="grid gap-2">
        <h4 className={label}>Comments and activity</h4>
        {feed.length === 0 ? (
          <p className="text-text-secondary">Nothing yet.</p>
        ) : (
          <ol className="grid gap-1.5">
            {feed.map((item) => item.kind === "comment" ? (
              <li key={item.id} className="flex gap-2.5 rounded-lg bg-card-soft px-3 py-2">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/[0.14] text-[10px] font-semibold text-accent" aria-hidden>
                  {initials(item.authorName ?? (role === "qa" ? "QA" : "Developer"))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-text-secondary">
                    <span className="font-medium text-text-primary">{item.authorName ?? (role === "qa" ? "QA" : "Developer")}</span> · {formatWhen(item.createdAt, tz)}
                  </p>
                  <p className="whitespace-pre-wrap text-text-primary">{item.body}</p>
                </div>
              </li>
            ) : (
              <li key={item.id} className="flex items-baseline gap-2 px-3 py-0.5 text-[12px] text-text-secondary">
                <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-text-muted/60" aria-hidden />
                <span>{item.text} — {formatWhen(item.createdAt, tz)}</span>
              </li>
            ))}
          </ol>
        )}
        <Composer
          participants={card.participants}
          pending={pending}
          note={note}
          onSubmit={(body) => {
            const fd = new FormData(); fd.set("issueId", card.id); fd.set("body", body);
            setNote(null);
            return new Promise<boolean>((resolve) => start(async () => {
              setError(null);
              const r = await onComment(fd);
              if (r.error) { setError(r.error); resolve(false); return; }
              if (r.mentioned) {
                setNote(r.unnotified?.length
                  ? `Mentioned ${r.mentioned}, pinged ${r.notified ?? 0} — ${r.unnotified.join("; ")}`
                  : `Pinged ${r.notified} on Slack`);
              }
              resolve(true);
            }));
          }}
        />
      </section>
    </div>
  );
}

/**
 * The comment box. Typing "@" offers the card's participants — reporter and
 * assignee, never the whole team — and picking one inserts "@Label ". The
 * server resolves labels to ids against the same list, so this is a
 * convenience, not the authority.
 */
function Composer({ participants, pending, note, onSubmit }: {
  participants: string[]; pending: boolean; note: string | null; onSubmit: (body: string) => Promise<boolean>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [menu, setMenu] = useState<{ start: number; query: string; index: number } | null>(null);

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0 || (at > 0 && /[\p{L}\p{N}]/u.test(before[at - 1]))) { setMenu(null); return; }
    const query = before.slice(at + 1);
    if (/\n/.test(query) || query.length > 40) { setMenu(null); return; }
    setMenu({ start: at, query, index: 0 });
  };
  const options = menu
    ? participants.filter((p) => p.toLowerCase().startsWith(menu.query.toLowerCase()))
    : [];
  const pick = (labelText: string) => {
    const el = ref.current; if (!el || !menu) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = `${el.value.slice(0, menu.start)}@${labelText} ${el.value.slice(caret)}`;
    setValue(next); setMenu(null);
    requestAnimationFrame(() => { el.focus(); const pos = menu.start + labelText.length + 2; el.setSelectionRange(pos, pos); });
  };
  useEffect(() => { if (menu && options.length === 0) setMenu(null); }, [menu, options.length]);

  return (
    <form
      className="relative grid gap-2"
      onSubmit={async (e) => { e.preventDefault(); const body = value.trim(); if (!body) return; if (await onSubmit(body)) setValue(""); }}
    >
      <textarea
        ref={ref} name="body" rows={2} required value={value}
        placeholder={participants.length ? `Add a comment — @ to mention ${participants.join(" or ")}` : "Add a comment"}
        onChange={(e) => { setValue(e.target.value); detect(e.target); }}
        onKeyDown={(e) => {
          if (!menu || !options.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % options.length }); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + options.length) % options.length }); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[menu.index]); }
          else if (e.key === "Escape") { setMenu(null); }
        }}
        aria-autocomplete="list" aria-expanded={!!menu && options.length > 0} aria-controls="mention-menu"
        className={field}
      />
      {menu && options.length > 0 && (
        <ul id="mention-menu" role="listbox" className="absolute left-2 top-full z-10 -mt-1 min-w-40 rounded-lg border border-border-soft bg-card p-1 shadow-md">
          {options.map((p, i) => (
            <li key={p} role="option" aria-selected={i === menu.index}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${i === menu.index ? "bg-accent/10 text-text-primary" : "text-text-primary hover:bg-card-soft"}`}>
                <span className="flex size-5 items-center justify-center rounded-full bg-accent/[0.14] text-[9px] font-semibold text-accent">{initials(p)}</span>
                @{p}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-secondary" aria-live="polite">{note ?? ""}</span>
        <Button type="submit" variant="ghost" disabled={pending}>Comment</Button>
      </div>
    </form>
  );
}
