"use client";

import { useActionState, useRef } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { setRank } from "@/app/dashboard/team/actions";
import { RANKS, RANK_BLURB, RANK_LABELS, type Rank } from "@/lib/permissions";

/** Inline access control. Submits on change rather than behind a Save button:
 *  there is one field, so a second click would buy nothing.
 *
 *  The select is uncontrolled and keyed on the stored rank plus the last error.
 *  That means the server is always the source of truth — a refusal remounts the
 *  select back to what is actually stored, so the screen can never show an
 *  access level the database rejected. It also avoids syncing prop into state
 *  through an effect, which is a cascading-render trap. */
export function RankSelect({
  memberId,
  rank,
  name,
  disabled,
  disabledReason,
}: {
  memberId: string;
  rank: Rank;
  name: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, action, pending] = useActionState(
    setRank,
    {} as { ok?: boolean; error?: string },
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={memberId} />
      <div className="flex items-center gap-1.5">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-text-muted" />
        ) : (
          <ShieldCheck
            className={rank === "ADMIN" ? "size-3.5 text-accent" : "size-3.5 text-text-muted"}
            strokeWidth={1.75}
          />
        )}
        <select
          key={`${rank}:${state?.error ?? ""}`}
          name="rank"
          defaultValue={rank}
          disabled={disabled || pending}
          aria-label={`Access level for ${name}`}
          title={disabled ? disabledReason : RANK_BLURB[rank]}
          onChange={() => formRef.current?.requestSubmit()}
          className="rounded-md border border-border-soft bg-card px-2 py-1 text-[13px] text-text-primary outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:text-text-muted"
        >
          {RANKS.map((r) => (
            <option key={r} value={r}>
              {RANK_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {state?.error && (
        <span className="max-w-[16rem] text-right text-[11px] leading-snug text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
