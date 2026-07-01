"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/** A "+ Add month" pill that opens the native month picker and navigates there. */
export function AddMonth() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    // showPicker() reliably opens the native month picker on click. A transparent
    // <input type="month"> otherwise only opens from its (invisible) calendar
    // indicator, so the pill reads as unclickable. Fall back to focus() where
    // showPicker is unsupported.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/45 bg-accent/[0.06] px-3.5 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/12"
      >
        <Plus className="size-4" /> Add month
      </button>
      <input
        ref={inputRef}
        type="month"
        aria-label="Add or open a month"
        onChange={(e) => {
          if (e.target.value) {
            router.push(`/dashboard/reports?month=${e.target.value}`);
          }
        }}
        // Visually hidden but still laid out, so showPicker() anchors the popup
        // to the pill. pointer-events-none lets the button above receive clicks.
        className="pointer-events-none absolute inset-0 opacity-0"
        tabIndex={-1}
      />
    </div>
  );
}
