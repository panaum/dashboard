"use client";

import { useTransition } from "react";
import { Check, Palette } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A board's accent. Presets rather than a colour wheel: this is for telling
// two boards apart at a glance, not for design work, and every preset already
// reads against the app's surfaces in both themes.
const PRESETS = [
  { hex: "#4f46e5", name: "Indigo" },
  { hex: "#0f766e", name: "Teal" },
  { hex: "#b45309", name: "Amber" },
  { hex: "#be123c", name: "Rose" },
  { hex: "#4d7c0f", name: "Olive" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#0369a1", name: "Blue" },
  { hex: "#475569", name: "Slate" },
];

export function AccentPicker({
  color,
  onPick,
}: {
  projectId: string;
  color: string | null;
  onPick: (color: string | null) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [pending, start] = useTransition();
  const set = (hex: string | null, close: () => void) => {
    close();
    start(async () => { await onPick(hex); });
  };
  return (
    <Popover
      align="end"
      width="w-56"
      title="Board accent"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-label="Board accent"
          title="Board accent"
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-card hover:text-text-primary"
        >
          <span className="size-3 rounded-full ring-1 ring-inset ring-black/10" style={{ background: color ?? "var(--color-accent)" }} />
          <Palette className="size-3.5" />
        </button>
      )}
    >
      {(close) => (
        <div className="grid gap-2">
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.hex}
                type="button"
                title={p.name}
                aria-label={p.name}
                onClick={() => set(p.hex, close)}
                className="flex size-9 items-center justify-center rounded-md ring-1 ring-inset ring-black/10"
                style={{ background: p.hex }}
              >
                {color?.toLowerCase() === p.hex && <Check className="size-4 text-white" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => set(null, close)}
            className={cn("rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-card-soft", !color && "font-medium")}
          >
            Use the default
          </button>
        </div>
      )}
    </Popover>
  );
}
