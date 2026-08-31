"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { setPageStatus } from "@/app/dashboard/clients/[clientId]/[projectId]/actions";
import { STATUSES, STATUS_TONE, label, type Status, type Tone } from "@/lib/constants";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-card-soft text-text-secondary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/12 text-error",
  info: "bg-info/12 text-info",
  brand: "bg-brand-purple/25 text-brand-primary",
};

/** Status badge that doubles as an inline dropdown to change a page's status. */
export function StatusSelect({
  pageId,
  status,
  clientId,
  projectId,
}: {
  pageId: string;
  status: Status;
  clientId: string;
  projectId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full text-xs font-semibold transition-opacity",
        TONE_CLASS[STATUS_TONE[status]],
        pending && "opacity-60",
      )}
    >
      <select
        value={status}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          startTransition(async () => {
            await setPageStatus({ pageId, status: value, clientId, projectId });
            router.refresh();
          });
        }}
        aria-label="Change page status"
        className="cursor-pointer appearance-none rounded-full bg-transparent py-0.5 pl-2.5 pr-6 outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s} className="bg-card text-text-primary">
            {label(s)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 opacity-70" />
    </div>
  );
}
