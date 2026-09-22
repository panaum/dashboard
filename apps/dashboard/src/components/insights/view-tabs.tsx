import Link from "next/link";
import { cn } from "@/lib/utils";

// Process first, the team third. The order is the argument: a defect rate by
// platform has an n in the hundreds, a defect rate by person has an n in the
// tens, and the page used to open on the one with the thinnest evidence and
// the highest social cost.
//
// The key stays "people" so existing links keep working; only the label reads
// "Team", which is what this team calls it.
//
// The accent appears here and on focus rings, and nowhere else. Current state
// is one of the two jobs it is allowed to do.

export const VIEWS = [
  { key: "process", label: "Process" },
  { key: "clients", label: "Clients" },
  { key: "people", label: "Team" },
  { key: "delivery", label: "Delivery" },
] as const;

export type ViewKey = (typeof VIEWS)[number]["key"];

export function isView(v: string | undefined): v is ViewKey {
  return VIEWS.some((x) => x.key === v);
}

export function ViewTabs({ active, hrefFor }: { active: ViewKey; hrefFor: (v: ViewKey) => string }) {
  return (
    <nav aria-label="Insights views" className="flex flex-wrap gap-6 border-b border-[var(--hairline)]">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={hrefFor(v.key)}
          aria-current={v.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b px-0 pb-2.5 text-[13px] transition-colors",
            v.key === active
              ? "border-[var(--focus)] font-medium text-[var(--ink)]"
              : "border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]",
          )}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
