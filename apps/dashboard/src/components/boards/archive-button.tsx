"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveBoard, unarchiveBoard } from "@/app/dashboard/boards/actions";

// Archive and unarchive are the same control in two directions. Neither
// confirms: archiving destroys nothing and the opposite button is one click
// away on the archive page, so a dialog would only be ceremony.

export function ArchiveButton({ projectId, name }: { projectId: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      title={`Archive ${name} — nothing is deleted`}
      aria-label={`Archive ${name}`}
      onClick={() =>
        start(async () => {
          await archiveBoard({ projectId });
          router.refresh();
        })
      }
      className="rounded-md bg-card p-1.5 text-text-secondary shadow-xs transition-colors hover:bg-card-soft hover:text-text-primary disabled:opacity-50"
    >
      <Archive className="size-4" strokeWidth={2} />
    </button>
  );
}

export function UnarchiveButton({ projectId, name }: { projectId: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Restore ${name}`}
      onClick={() =>
        start(async () => {
          await unarchiveBoard({ projectId });
          router.refresh();
        })
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-soft bg-card px-2.5 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:border-accent/50 hover:bg-accent/[0.06] disabled:opacity-50"
    >
      <ArchiveRestore className="size-3.5" strokeWidth={2} />
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
