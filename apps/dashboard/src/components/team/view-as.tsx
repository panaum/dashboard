"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { startPreview } from "@/app/dashboard/preview/actions";
import { RANK_LABELS } from "@/lib/permissions";

/** On a person's Team row: see the app exactly as they would. */
export function ViewAsButton({ memberId, name }: { memberId: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const r = await startPreview({ memberId });
        if (r?.error) setError(r.error);
      })}
      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary disabled:opacity-50"
      aria-label={`View as ${name}`}
      title={error ?? `View as ${name}`}
    >
      <Eye className="size-4" />
    </button>
  );
}

/** In the Team header: preview a rank in general, when no one person is the
 *  point — testing what Member or Viewer can do, not impersonating anyone. */
export function PreviewAsRank() {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1 rounded-full border border-border-soft bg-card p-1 text-[13px] shadow-xs">
      <span className="flex items-center gap-1.5 px-2.5 text-text-secondary">
        <Eye className="size-3.5" /> Preview as
      </span>
      {(["MEMBER", "VIEWER"] as const).map((rank) => (
        <button
          key={rank}
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await startPreview({ rank }); })}
          className="rounded-full px-3 py-1 font-medium text-text-primary transition-colors hover:bg-accent/[0.08] hover:text-accent disabled:opacity-50"
        >
          {RANK_LABELS[rank]}
        </button>
      ))}
    </div>
  );
}
