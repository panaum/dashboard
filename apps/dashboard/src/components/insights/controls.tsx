import Link from "next/link";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { cn } from "@/lib/utils";

// The filter bar, in the page's own system rather than the app's.
//
// The shared Select and Button carry the app's blue-grey borders, 8px radius
// and shadow, which is a different design language from this page. Importing
// them would have been fewer lines and would have read as two systems bolted
// together — and holding one direction everywhere is most of what separates a
// considered tool from a template.

export function TSelect({
  name, defaultValue, children, label,
}: {
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      className={cn(
        "h-8 rounded-[var(--r-chip)] border border-[var(--hairline-strong)] bg-[var(--surface)] px-2",
        "text-[13px] text-[var(--ink)] outline-none transition-colors",
        "hover:border-[var(--ink-3)] focus-visible:border-[var(--focus)] focus-visible:ring-1 focus-visible:ring-[var(--focus)]",
      )}
    >
      {children}
    </select>
  );
}

export function TButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className={cn(
        "h-8 rounded-[var(--r-chip)] border border-[var(--focus)] bg-[var(--focus)] px-3",
        "text-[13px] font-medium text-white transition-opacity hover:opacity-90",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]",
      )}
    >
      {children}
    </button>
  );
}

export function TLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--r-chip)] text-[13px] text-[var(--ink-2)] underline-offset-4 transition-colors hover:text-[var(--ink)] hover:underline"
    >
      {children}
    </Link>
  );
}

/** A figure and its label, the only place on the page type runs to 32px. */
export function Tile({
  label, value, unit, note, decimals = 0, band,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  note?: string;
  decimals?: number;
  band?: "good" | "watch" | "poor" | null;
}) {
  // Counts up on first load. This was here before the terminal restyle and
  // got dropped in it — a regression, not a decision.
  const shown =
    value === null ? (
      "—"
    ) : typeof value === "number" ? (
      <AnimatedNumber value={value} decimals={decimals} />
    ) : (
      value
    );
  const ink =
    band === "good" ? "text-[var(--good)]"
    : band === "watch" ? "text-[var(--watch)]"
    : band === "poor" ? "text-[var(--poor)]"
    : "text-[var(--ink)]";
  return (
    <div className="panel t-in flex min-h-[104px] flex-col justify-between p-4">
      <span className="t-micro">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={cn("t-kpi fig", value === null ? "text-[var(--ink-3)]" : ink)}>{shown}</span>
        {unit && value !== null && (
          <span className="text-[13px] text-[var(--ink-2)]">{unit}</span>
        )}
      </span>
      <span className="t-body min-h-[19px] text-[var(--ink-3)]">{note}</span>
    </div>
  );
}
