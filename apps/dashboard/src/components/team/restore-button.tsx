"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreMember } from "@/app/dashboard/team/actions";

/** On the row of someone who left: let them back in. A new login is set
 *  afterwards from the key button — theirs was cleared when they left. */
export function RestoreButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await restoreMember({ id }); router.refresh(); })}
      title={`Restore ${name}'s access, then set a new login`}
      className="shrink-0 rounded-full border border-border-soft bg-card px-2.5 py-0.5 text-[11px] font-semibold text-text-primary transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-50"
    >
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
