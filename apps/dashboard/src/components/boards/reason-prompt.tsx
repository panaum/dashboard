"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// WHY IS THIS CARD STOPPING?
//
// Moving a card into Discussed is the one transition that means work has
// halted, and the question "why" is the entire value of the column — a board
// full of cards nobody can explain is what the column was invented to prevent.
//
// So the reason is asked BEFORE the move, not after: the card does not move
// until there is an answer, which is the only way the answer always exists.
// The server enforces the same rule, because a dialog is not a constraint.

export function ReasonPrompt({
  stageLabel,
  cardTitle,
  onCancel,
  onSubmit,
}: {
  stageLabel: string;
  cardTitle: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Portals need a DOM, and this renders on the server first. Subscribing to
  // nothing is how you ask "am I hydrated yet" without writing state in an
  // effect, which the lint rule correctly objects to.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  useEffect(() => { box.current?.focus(); }, [mounted]);

  const ready = reason.trim().length > 0;
  const submit = () => { if (ready) onSubmit(reason.trim()); };

  const ui = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Why is ${cardTitle} moving to ${stageLabel}?`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        // ⌘/Ctrl+Enter submits, like every other composer in this app.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border-soft bg-card p-5 shadow-md"
      >
        <h2 className="text-[15px] font-semibold text-text-primary">
          Moving to {stageLabel}
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Say what needs clarifying on <span className="font-medium text-text-primary">{cardTitle}</span>.
          Whoever opens the card next will see this.
        </p>
        <textarea
          ref={box}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. the spec says 3 columns but the design has 4 — which is right?"
          className="mt-3 w-full resize-y rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-[13px] text-text-secondary transition-colors hover:bg-card-soft hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={submit}
            className={cn(
              "rounded-lg px-3.5 py-2 text-[13px] font-medium text-white transition-opacity",
              ready ? "bg-accent hover:opacity-90" : "cursor-not-allowed bg-accent/40",
            )}
          >
            Move card
          </button>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(ui, document.body) : null;
}
