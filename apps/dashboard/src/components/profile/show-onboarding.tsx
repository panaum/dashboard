"use client";

import { Presentation } from "lucide-react";
import { showOnboarding } from "@/components/onboarding/onboarding";
import { RANK_LABELS } from "@/lib/permissions";

/** Admin-only: play the first-run experience as a new person of that rank
 *  would get it — for walking the team through it. Nothing is saved. */
export function ShowOnboarding() {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-border-soft bg-card p-1 text-[13px] shadow-xs">
      <span className="flex items-center gap-1.5 px-2.5 text-text-secondary">
        <Presentation className="size-3.5" /> Show onboarding as
      </span>
      {(["VIEWER", "MEMBER", "ADMIN"] as const).map((rank) => (
        <button
          key={rank}
          type="button"
          onClick={() => showOnboarding(rank)}
          className="rounded-full px-3 py-1 font-medium text-text-primary transition-colors hover:bg-accent/[0.08] hover:text-accent"
        >
          {RANK_LABELS[rank]}
        </button>
      ))}
    </div>
  );
}
