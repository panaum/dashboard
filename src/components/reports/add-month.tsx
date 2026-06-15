"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/** A "+ Add month" pill that opens the native month picker and navigates there. */
export function AddMonth() {
  const router = useRouter();
  return (
    <div className="group relative">
      <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/45 bg-accent/[0.06] px-3.5 py-1.5 text-[13px] font-semibold text-accent transition-colors group-hover:bg-accent/12">
        <Plus className="size-4" /> Add month
      </span>
      <input
        type="month"
        aria-label="Add or open a month"
        onChange={(e) => {
          if (e.target.value) {
            router.push(`/dashboard/reports?month=${e.target.value}`);
          }
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  );
}
