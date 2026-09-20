"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SEVERITIES } from "@/lib/constants";
import type { Member } from "./types";

// QA logs an issue straight onto the board. It lands in NEW, at the bottom,
// and its creation is the first event on its record.

export function NewCardForm({
  projectId, pages, members, onCreate,
}: {
  projectId: string;
  pages: { id: string; name: string }[];
  members: Member[];
  onCreate: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "w-full rounded-lg border border-border-soft bg-card px-3 py-2 text-[13px] text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary";
  return (
    <Dialog title="Log an issue" trigger={<Button type="button">Log an issue</Button>}>
      {(close) => (
        <form
          className="grid gap-3 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("projectId", projectId);
            start(async () => { setError(null); const r = await onCreate(fd); if (r.error) setError(r.error); else close(); });
          }}
        >
          {error && <p role="alert" className="rounded-lg bg-error/[0.11] px-3 py-2 text-error-strong">{error}</p>}
          <label className="grid gap-1"><span className={label}>Page</span>
            <select name="pageId" required className={field} defaultValue="">
              <option value="" disabled>Which page is it on?</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="grid gap-1"><span className={label}>Title</span>
            <input name="title" required maxLength={200} placeholder="Phone field has no label" className={field} /></label>
          <label className="grid gap-1"><span className={label}>Description</span>
            <textarea name="description" rows={4} className={field} /></label>
          <label className="grid gap-1"><span className={label}>Link</span>
            <input name="link" placeholder="https://" className={field} /></label>
          {/* The screenshot most issues start from. Stored like any attachment and
              set as the card's cover, so it shows on the board face at once. */}
          <label className="grid gap-1"><span className={label}>Screenshot <span className="font-normal normal-case tracking-normal">(optional, becomes the cover)</span></span>
            <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" className="min-w-0 max-w-full text-[12px] text-text-secondary" /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1"><span className={label}>Severity</span>
              <select name="severity" defaultValue="MEDIUM" className={field}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s.replace("_", " / ").toLowerCase()}</option>)}
              </select></label>
            <label className="grid gap-1"><span className={label}>Assignee</span>
              <select name="assigneeId" defaultValue="" className={field}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" name="recurring" value="true" className="size-4 accent-accent" />
              <span className="text-text-primary">Recurring</span></label>
          </div>
          <Button type="submit" disabled={pending} className="justify-self-end">Add to board</Button>
        </form>
      )}
    </Dialog>
  );
}
