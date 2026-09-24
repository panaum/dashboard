"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { approveRankRequest, denyRankRequest } from "@/app/dashboard/team/actions";
import { RANK_LABELS } from "@/lib/permissions";
import { isRank } from "@/lib/onboarding";

export type PendingRequest = { id: string; toRank: string; reason: string | null; createdAt: string };

/**
 * A waiting rank request on the requester's Team row — the Boards-style count
 * badge, opening the approve/deny choice. Approving runs the same rank change
 * as the row's dropdown; denying leaves the rank alone and can carry a note
 * the requester sees on their profile.
 */
export function RankRequestBadge({ name, request }: { name: string; request: PendingRequest }) {
  const to = isRank(request.toRank) ? RANK_LABELS[request.toRank] : request.toRank;
  return (
    <Dialog
      title={`${name} asked for ${to} access`}
      trigger={
        <button
          type="button"
          className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-text-on-dark transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title={`${name} is waiting for ${to} access`}
        >
          Wants {to}
        </button>
      }
    >
      {(close) => <Review name={name} to={to} request={request} close={close} />}
    </Dialog>
  );
}

function Review({ name, to, request, close }: { name: string; to: string; request: PendingRequest; close: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) { setError(r.error); return; }
    close();
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Asked on <time suppressHydrationWarning>{new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>.
        {" "}{request.reason ? "Their reason:" : "They didn’t give a reason."}
      </p>
      {request.reason && (
        <blockquote className="rounded-lg bg-card-soft px-3.5 py-3 text-sm text-text-primary">{request.reason}</blockquote>
      )}
      <Field label="Note if you decline" htmlFor="review-note" hint={`Optional — ${name} sees it on their profile.`}>
        <Textarea id="review-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <span className="mr-auto text-xs text-error-strong" role="status">{error}</span>}
        <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => denyRankRequest({ id: request.id, note }))}>
          Decline
        </Button>
        <Button type="button" disabled={pending} onClick={() => run(() => approveRankRequest({ id: request.id }))}>
          Make {to}
        </Button>
      </div>
    </div>
  );
}
