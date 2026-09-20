"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SEVERITIES } from "@/lib/constants";
import type { Role } from "@/lib/boards";
import type { Card, Member } from "./types";

// The card, opened. QA edits every field inline; the developer reads the
// description, follows the link, sees the images, and talks in the thread.
// Severity and the recurring flag are not hidden here for the developer —
// they were never in the props.

type Result = { ok?: boolean; error?: string };

export function CardDialog({
  role, card, members, imageSrc, onSave, onComment, onImage, onDelete,
}: {
  role: Role;
  card: Card;
  members: Member[];
  /** URL for an image id — the developer's carries the board token. */
  imageSrc: (id: string) => string;
  onSave?: (fd: FormData) => Promise<Result>;
  onComment: (fd: FormData) => Promise<Result>;
  onImage: (fd: FormData) => Promise<Result>;
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
        <Body role={role} card={card} members={members} imageSrc={imageSrc}
              onSave={onSave} onComment={onComment} onImage={onImage} onDelete={onDelete} close={close} />
      )}
    </Dialog>
  );
}

function Body({ role, card, members, imageSrc, onSave, onComment, onImage, onDelete, close }: {
  role: Role; card: Card; members: Member[]; imageSrc: (id: string) => string;
  onSave?: (fd: FormData) => Promise<Result>; onComment: (fd: FormData) => Promise<Result>;
  onImage: (fd: FormData) => Promise<Result>; onDelete?: () => Promise<Result>; close: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, then?: () => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.error) setError(r.error); else then?.(); });

  const field = "w-full rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary";

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      {error && <p role="alert" className="rounded-lg bg-error/[0.11] px-3 py-2 text-error-strong">{error}</p>}

      {role === "qa" && onSave ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", card.id); run(() => onSave(fd)); }}
        >
          <label className="grid gap-1"><span className={label}>Title</span>
            <input name="title" defaultValue={card.title} required className={field} /></label>
          <label className="grid gap-1"><span className={label}>Description</span>
            <textarea name="description" defaultValue={card.description ?? ""} rows={4} className={field} /></label>
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
      ) : (
        <div className="grid gap-3">
          {card.description && <p className="whitespace-pre-wrap text-text-primary">{card.description}</p>}
          {card.link && (
            <a href={card.link} target="_blank" rel="noopener" className="w-fit text-accent hover:underline">{card.link}</a>
          )}
          <span className="text-[11px] text-text-secondary">Logged {card.createdAt.slice(0, 10)}</span>
        </div>
      )}

      {/* Images */}
      <section className="grid gap-2">
        <h4 className={label}>Screenshots</h4>
        {card.images.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {card.images.map((img) => (
              <li key={img.id}>
                <a href={imageSrc(img.id)} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageSrc(img.id)} alt="" className="h-28 w-full rounded-lg object-cover ring-1 ring-inset ring-border-soft" />
                </a>
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

      {/* Thread — clarification happens here, in place. */}
      <section className="grid gap-2">
        <h4 className={label}>Comments</h4>
        {card.comments.length === 0 ? (
          <p className="text-text-secondary">No comments yet.</p>
        ) : (
          <ol className="grid gap-2">
            {card.comments.map((c) => (
              <li key={c.id} className="rounded-lg bg-card-soft px-3 py-2">
                <p className="whitespace-pre-wrap text-text-primary">{c.body}</p>
                <p className="mt-1 text-[11px] text-text-secondary">{c.authorName ?? (role === "qa" ? "QA" : "Developer")} · {c.createdAt.slice(0, 16).replace("T", " ")}</p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="grid gap-2"
          onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); fd.set("issueId", card.id); run(() => onComment(fd), () => f.reset()); }}
        >
          <textarea name="body" rows={2} required placeholder="Add a comment" className={field} />
          <Button type="submit" variant="ghost" disabled={pending} className="justify-self-end">Comment</Button>
        </form>
      </section>
    </div>
  );
}
