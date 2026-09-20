"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlignLeft, Circle, Ellipsis, ExternalLink, Image as ImageIcon, Link2, MessageSquare, Paperclip, Plus, Repeat, Tag, Trash2, UserRound,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BOARD_STAGES, BOARD_STAGE_LABELS, SEVERITIES, type BoardStage } from "@/lib/constants";
import { canMove, type Role } from "@/lib/boards";
import { activityFeed, coverOf, formatStamp, initials } from "@/lib/board-thread";
import type { Card, CommentResult, Member, Result } from "./types";

// The card back, laid out like the reference: the cover bleeds to the edges
// with the stage pill on it top-left and the controls top-right; below, two
// columns — title, chips, description and attachments on the left; comments
// and activity, composer first, newest first, on the right.
//
// The stage pill fires the SAME move as a drag, so it writes the same
// IssueEvent. Severity, the recurring flag and the reporter are not hidden
// here for the developer — they were never in the props.

const SEVERITY_ROWS: { value: string; label: string; bar: string }[] = [
  { value: "CRITICAL_HIGH", label: "Critical / high", bar: "bg-error" },
  { value: "MEDIUM", label: "Medium", bar: "bg-warning" },
  { value: "LOW", label: "Low", bar: "bg-text-muted" },
  { value: "REPETITIVE", label: "Repetitive", bar: "bg-info" },
];
const severityRow = (v?: string) => SEVERITY_ROWS.find((r) => r.value === v) ?? null;

type Props = {
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
  onDeleteImage: (input: { issueId: string; imageId: string }) => Promise<Result>;
  onDelete?: () => Promise<Result>;
  /** Open on mount — for the card that was just added. */
  initialOpen?: boolean;
};

export function CardDialog(props: Props) {
  return (
    <Dialog
      size="xl" bare initialOpen={props.initialOpen}
      title={props.card.title}
      trigger={
        <button type="button" className="text-left text-[13px] font-medium leading-snug text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {props.card.title}
        </button>
      }
    >
      {(close) => <Body {...props} close={close} />}
    </Dialog>
  );
}

const chip = "inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-card px-2.5 py-1.5 text-[13px] font-medium text-text-primary hover:bg-card-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const heading = "flex items-center gap-2.5 text-[15px] font-semibold text-text-primary";
const boxField = "w-full rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

function Body({ role, card, members, imageSrc, onMove, onSave, onPatch, onComment, onImage, onCover, onDeleteImage, onDelete, close }: Props & { close: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [tint, setTint] = useState<string | null>(null);
  // Severity ticks the moment it is chosen; the server's value replaces it on
  // the next render, so a refused write cannot leave a phantom tick behind.
  const [sevPick, setSevPick] = useState(card.severity);
  useEffect(() => { setSevPick(card.severity); }, [card.severity]);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, then?: () => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.error) setError(r.error); else then?.(); });

  const qa = role === "qa";
  const cover = coverOf(card.images);
  const stages = BOARD_STAGES.filter((s) => s === card.boardStage || canMove(role, card.boardStage, s, { assigned: !!card.assigneeId }));
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  /** One write for the fields the developer never receives. */
  const saveDetails = (patch: Partial<{ link: string; severity: string; assigneeId: string; recurring: boolean }>) => {
    if (!onSave) return;
    const v = { link: card.link ?? "", severity: card.severity ?? "MEDIUM", assigneeId: card.assigneeId ?? "", recurring: !!card.recurring, ...patch };
    const fd = new FormData();
    fd.set("id", card.id); fd.set("title", card.title); fd.set("description", card.description ?? "");
    fd.set("link", v.link); fd.set("severity", v.severity); fd.set("assigneeId", v.assigneeId); if (v.recurring) fd.set("recurring", "true");
    run(() => onSave(fd));
  };
  const patch = (key: "title" | "description", value: string) => {
    if (!onPatch) return;
    const current = key === "title" ? card.title : (card.description ?? "");
    if (value.trim() === current.trim()) return;
    const fd = new FormData(); fd.set("id", card.id); fd.set(key, value);
    run(() => onPatch(fd));
  };
  const upload = (file: File) => {
    const fd = new FormData(); fd.set("issueId", card.id); fd.set("image", file);
    run(() => onImage(fd));
  };
  // The banner takes its colour from the image, like the reference — the
  // image is same-origin (our own /api route), so a 1×1 canvas can read it.
  const tintFrom = (img: HTMLImageElement) => {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      setTint(`rgb(${Math.round(r * 0.55)} ${Math.round(g * 0.55)} ${Math.round(b * 0.55)})`);
    } catch { /* tainted or unsupported: keep the neutral backdrop */ }
  };

  const feed = activityFeed(card.comments, card.events).reverse().filter((i) => showDetails || i.kind === "comment");
  const sev = severityRow(card.severity);
  const stagePill = (
    <select
      aria-label="Stage" value={card.boardStage} disabled={stages.length < 2}
      onChange={(e) => { const to = e.target.value as BoardStage; if (to !== card.boardStage) onMove(to); }}
      className={cn("appearance-none rounded-md py-1 pl-2.5 pr-7 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-80",
        cover ? "bg-black/45 text-white" : "border border-border-soft bg-card text-text-primary")}
      style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='${cover ? "white" : "%2366667a"}' stroke-width='1.5'/></svg>")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 0.6rem center" }}
    >
      {stages.map((s) => <option key={s} value={s}>{BOARD_STAGE_LABELS[s]}</option>)}
    </select>
  );
  const iconBtn = (onCoverBg: boolean) => cn("rounded-full p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
    onCoverBg ? "bg-black/35 text-white hover:bg-black/55" : "text-text-secondary hover:bg-card-soft hover:text-text-primary");

  // Paste a screenshot while the card is open and it attaches — the first
  // one becomes the cover. Listened for on the document, like the reference,
  // because right after opening nothing inside the card has focus and a
  // paste would otherwise land on <body>. Text pastes are left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (!f) return;
      e.preventDefault(); upload(f); setNote(`Attached ${f.name || "screenshot"}`);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  return (
    <div className="flex flex-col text-[13px]">
      {/* Header: the cover, or a plain bar when there is none. */}
      <div className="relative" style={cover ? { background: tint ?? "var(--color-card-soft)" } : undefined}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc(cover.id)} alt="" crossOrigin="anonymous" onLoad={(e) => tintFrom(e.currentTarget)}
               className="mx-auto block h-56 max-w-full object-contain" />
        ) : (
          <div className="h-14 bg-card-soft" />
        )}
        <div className="absolute left-4 top-3">{stagePill}</div>
        <div className="absolute right-14 top-3 flex items-center gap-1.5">
          {cover && (
            <button type="button" title="Remove cover" aria-label="Remove cover" disabled={pending} className={iconBtn(true)}
                    onClick={() => run(() => onCover({ issueId: card.id, imageId: null }))}>
              <ImageIcon className="size-4" />
            </button>
          )}
          {qa && onDelete && (
            <Popover align="end" width="w-56" title="Card actions"
              trigger={({ toggle }) => (
                <button type="button" aria-label="More actions" onClick={toggle} className={iconBtn(!!cover)}><Ellipsis className="size-4" /></button>
              )}>
              {(closeMenu) => (
                <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-error-strong hover:bg-error/[0.08]"
                        onClick={() => { closeMenu(); if (confirm("Delete this card? Its comments and attachments go with it.")) run(onDelete, close); }}>
                  <Trash2 className="size-4" /> Delete card
                </button>
              )}
            </Popover>
          )}
        </div>
      </div>

      {error && <p role="alert" className="mx-6 mt-4 rounded-lg bg-error/[0.11] px-3 py-2 text-error-strong">{error}</p>}

      <div className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── Left: the card ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-7">
          <div className="flex items-start gap-3">
            <Circle className="mt-2 size-5 shrink-0 text-text-muted" strokeWidth={1.75} aria-hidden />
            {qa && onPatch ? (
              <input
                aria-label="Title" defaultValue={card.title} required maxLength={200}
                onBlur={(e) => patch("title", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                className="-ml-2 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[22px] font-bold leading-tight tracking-tight text-text-primary hover:border-border-soft focus-visible:border-border-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
            ) : (
              <h2 className="py-1 text-[22px] font-bold leading-tight tracking-tight text-text-primary">{card.title}</h2>
            )}
          </div>

          {/* Chips: the reference's Add · Labels · Members row. Severity is our Labels. */}
          <div className="ml-8 flex flex-wrap items-center gap-2">
            <Popover title="Add to card" width="w-64"
              trigger={({ toggle }) => <button type="button" onClick={toggle} className={cn(chip, "bg-accent text-text-on-dark hover:bg-accent-bright border-transparent")}><Plus className="size-4" /> Add</button>}>
              {(closeMenu) => (
                <div className="grid gap-1">
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-card-soft">
                    <span className="flex size-8 items-center justify-center rounded-md border border-border-soft"><Paperclip className="size-4" /></span>
                    <span><span className="block font-medium">Attachment</span><span className="block text-[12px] text-text-secondary">PNG, JPEG, WebP or GIF, up to 4 MB</span></span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only"
                           onChange={(e) => { const f = e.target.files?.[0]; if (f) { upload(f); closeMenu(); } }} />
                  </label>
                  {qa && onSave && (
                    <form className="grid gap-2 rounded-md px-2 py-1.5" onSubmit={(e) => { e.preventDefault(); saveDetails({ link: String(new FormData(e.currentTarget).get("link") ?? "") }); closeMenu(); }}>
                      <span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-md border border-border-soft"><Link2 className="size-4" /></span><span className="font-medium">Link</span></span>
                      <input name="link" defaultValue={card.link ?? ""} placeholder="https://" className={boxField} />
                      <Button type="submit" size="sm" className="justify-self-end">Save</Button>
                    </form>
                  )}
                </div>
              )}
            </Popover>
            {qa && onSave && (<>
              <Popover title="Severity" width="w-64"
                trigger={({ toggle }) => <button type="button" onClick={toggle} className={chip}><Tag className="size-4" /> Severity</button>}>
                {(closeMenu) => (
                  <div className="grid gap-1.5">
                    {SEVERITY_ROWS.map((r) => (
                      <label key={r.value} className="flex cursor-pointer items-center gap-2">
                        <input type="radio" name="severity" value={r.value} checked={sevPick === r.value} className="size-4 accent-accent"
                               onChange={() => { setSevPick(r.value); saveDetails({ severity: r.value }); closeMenu(); }} />
                        <span className={cn("flex h-8 flex-1 items-center rounded-md px-3 text-[13px] font-medium text-white", r.bar)}>{r.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Popover>
              <Popover title="Assignee" width="w-64"
                trigger={({ toggle }) => <button type="button" onClick={toggle} className={chip}><UserRound className="size-4" /> Assignee</button>}>
                {(closeMenu) => (
                  <div className="grid gap-0.5">
                    <button type="button" onClick={() => { saveDetails({ assigneeId: "" }); closeMenu(); }}
                            className={cn("rounded-md px-2 py-1.5 text-left hover:bg-card-soft", !card.assigneeId && "bg-accent/10 font-medium")}>Unassigned</button>
                    {members.map((m) => (
                      <button key={m.id} type="button" onClick={() => { saveDetails({ assigneeId: m.id }); closeMenu(); }}
                              className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-card-soft", card.assigneeId === m.id && "bg-accent/10 font-medium")}>
                        <Avatar name={m.name} size="sm" /> {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
              <button type="button" aria-pressed={!!card.recurring} onClick={() => saveDetails({ recurring: !card.recurring })}
                      className={cn(chip, card.recurring && "border-info/40 bg-info/[0.14]")}>
                <Repeat className="size-4" /> Recurring
              </button>
            </>)}
          </div>

          {/* What is set: the reference's Labels / Members blocks under the title. */}
          {(sev || card.assigneeName || card.link) && (
            <div className="ml-8 flex flex-wrap gap-x-6 gap-y-3">
              {sev && (
                <div className="grid gap-1"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Severity</span>
                  <span className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-white", sev.bar)}>{sev.label}</span></div>
              )}
              {card.assigneeName && (
                <div className="grid gap-1"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Assignee</span>
                  <span className="inline-flex items-center gap-2"><Avatar name={card.assigneeName} size="sm" /><span className="text-text-primary">{card.assigneeName}</span></span></div>
              )}
              {card.link && (
                <div className="grid gap-1"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Link</span>
                  <a href={card.link} target="_blank" rel="noopener" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-soft px-2.5 text-[12px] text-accent hover:underline"><Link2 className="size-3.5" />{card.link.replace(/^https?:\/\//, "").slice(0, 48)}</a></div>
              )}
            </div>
          )}

          {/* Description */}
          <section className="grid gap-3">
            <h3 className={heading}><AlignLeft className="size-5 text-text-secondary" strokeWidth={1.75} /> Description</h3>
            {qa && onPatch ? (
              <textarea
                aria-label="Description" defaultValue={card.description ?? ""} rows={3} maxLength={4000}
                placeholder="Add a more detailed description…"
                onBlur={(e) => patch("description", e.target.value)}
                className="ml-8 min-h-20 w-[calc(100%-2rem)] resize-y rounded-lg border border-border-soft bg-card px-3 py-2.5 text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              />
            ) : card.description ? (
              <p className="ml-8 whitespace-pre-wrap text-text-primary">{card.description}</p>
            ) : (
              <p className="ml-8 text-text-muted">No description yet.</p>
            )}
          </section>

          {/* Attachments */}
          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <h3 className={heading}><Paperclip className="size-5 text-text-secondary" strokeWidth={1.75} /> Attachments</h3>
              <label className={cn(chip, "cursor-pointer")}>
                Add
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              </label>
            </div>
            {card.images.length > 0 ? (
              <div className="ml-8 grid gap-2">
                <span className="text-[12px] font-semibold text-text-secondary">Files</span>
                <ul className="grid gap-2">
                  {card.images.map((img) => (
                    <li key={img.id} className="flex items-center gap-3">
                      <a href={imageSrc(img.id)} target="_blank" rel="noopener" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageSrc(img.id)} alt="" className="h-14 w-20 rounded-md bg-card-soft object-cover ring-1 ring-inset ring-border-soft" />
                      </a>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-text-primary">{img.filename ?? "Image"}</p>
                        <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-secondary">
                          Added {formatStamp(img.createdAt, tz)}
                          {img.isCover && <><span aria-hidden>•</span><span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" /> Cover</span></>}
                        </p>
                      </div>
                      <a href={imageSrc(img.id)} target="_blank" rel="noopener" aria-label="Open image" className={iconBtn(false)}><ExternalLink className="size-4" /></a>
                      <Popover align="end" width="w-52" title="Attachment"
                        trigger={({ toggle }) => <button type="button" aria-label="Attachment actions" onClick={toggle} className={cn(iconBtn(false), "border border-border-soft")}><Ellipsis className="size-4" /></button>}>
                        {(closeMenu) => (
                          <div className="grid gap-0.5">
                            <button type="button" className="rounded-md px-2 py-1.5 text-left hover:bg-card-soft"
                                    onClick={() => { closeMenu(); run(() => onCover({ issueId: card.id, imageId: img.isCover ? null : img.id })); }}>
                              {img.isCover ? "Remove cover" : "Make cover"}
                            </button>
                            <button type="button" className="rounded-md px-2 py-1.5 text-left text-error-strong hover:bg-error/[0.08]"
                                    onClick={() => { closeMenu(); if (confirm("Delete this attachment?")) run(() => onDeleteImage({ issueId: card.id, imageId: img.id })); }}>
                              Delete
                            </button>
                          </div>
                        )}
                      </Popover>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="ml-8 text-text-muted">No attachments yet.</p>
            )}
          </section>
        </div>

        {/* ── Right: comments and activity ───────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-4 md:border-l md:border-border-soft md:pl-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className={heading}><MessageSquare className="size-5 text-text-secondary" strokeWidth={1.75} /> Comments and activity</h3>
            <button type="button" onClick={() => setShowDetails((v) => !v)} className={chip}>{showDetails ? "Hide details" : "Show details"}</button>
          </div>
          <Composer
            participants={card.participants} pending={pending} note={note}
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
          {feed.length === 0 ? (
            <p className="text-text-muted">Nothing yet.</p>
          ) : (
            <ol className="grid gap-4">
              {feed.map((item) => {
                const who = item.kind === "comment" ? (item.authorName ?? (qa ? "QA" : "Developer")) : (item.actorName ?? "Someone");
                return (
                  <li key={item.id} className="flex gap-3">
                    <Avatar name={who} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      {item.kind === "comment" ? (<>
                        <p className="text-[12px] text-text-secondary"><span className="font-semibold text-text-primary">{who}</span> · {formatStamp(item.createdAt, tz)}</p>
                        <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border-soft bg-card px-3 py-2 text-text-primary shadow-xs">{item.body}</p>
                      </>) : (<>
                        <p className="text-text-primary"><span className="font-semibold">{who}</span> {item.text.slice(who.length + 1)}</p>
                        <p className="text-[12px] text-text-secondary underline decoration-border-soft underline-offset-2">{formatStamp(item.createdAt, tz)}</p>
                      </>)}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * "Write a comment…" — a single line until focused, then the box and a Save
 * button. Typing "@" offers the card's participants — reporter and assignee,
 * never the whole team; the server resolves labels to ids against the same
 * list, so this is a convenience, not the authority.
 */
function Composer({ participants, pending, note, onSubmit }: {
  participants: string[]; pending: boolean; note: string | null; onSubmit: (body: string) => Promise<boolean>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [active, setActive] = useState(false);
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
  const options = menu ? participants.filter((p) => p.toLowerCase().startsWith(menu.query.toLowerCase())) : [];
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
      onSubmit={async (e) => { e.preventDefault(); const body = value.trim(); if (!body) return; if (await onSubmit(body)) { setValue(""); setActive(false); } }}
    >
      <textarea
        ref={ref} name="body" rows={active || value ? 3 : 1} required value={value}
        placeholder="Write a comment…"
        onFocus={() => setActive(true)}
        onChange={(e) => { setValue(e.target.value); detect(e.target); }}
        onKeyDown={(e) => {
          if (!menu || !options.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % options.length }); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + options.length) % options.length }); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[menu.index]); }
          else if (e.key === "Escape") { setMenu(null); }
        }}
        aria-autocomplete="list" aria-expanded={!!menu && options.length > 0} aria-controls="mention-menu"
        className={cn(boxField, "resize-none shadow-xs")}
      />
      {menu && options.length > 0 && (
        <ul id="mention-menu" role="listbox" className="absolute left-2 top-full z-10 -mt-1 min-w-40 rounded-lg border border-border-soft bg-card p-1 shadow-md">
          {options.map((p, i) => (
            <li key={p} role="option" aria-selected={i === menu.index}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", i === menu.index ? "bg-accent/10 text-text-primary" : "text-text-primary hover:bg-card-soft")}>
                <span className="flex size-5 items-center justify-center rounded-full bg-accent/[0.14] text-[9px] font-semibold text-accent">{initials(p)}</span>
                @{p}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(active || value) && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-secondary" aria-live="polite">
            {note ?? (participants.length ? `@ to mention ${participants.join(" or ")}` : "")}
          </span>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setValue(""); setActive(false); }}>Cancel</Button>
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
          </div>
        </div>
      )}
      {!active && !value && note && <span className="text-[11px] text-text-secondary" aria-live="polite">{note}</span>}
    </form>
  );
}
