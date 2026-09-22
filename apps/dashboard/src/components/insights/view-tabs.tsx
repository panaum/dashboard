import Link from "next/link";
import { cn } from "@/lib/utils";

// Process first, people third. The order is the argument: a defect rate by
// platform has an n in the hundreds, a defect rate by person has an n in the
// tens, and the page used to open on the one with the thinnest evidence and
// the highest social cost.

export const VIEWS = [
  { key: "process", label: "Process" },
  { key: "clients", label: "Clients" },
  { key: "people", label: "People" },
  { key: "delivery", label: "Delivery" },
] as const;

export type ViewKey = (typeof VIEWS)[number]["key"];

export function isView(v: string | undefined): v is ViewKey {
  return VIEWS.some((x) => x.key === v);
}

export function ViewTabs({ active, hrefFor }: { active: ViewKey; hrefFor: (v: ViewKey) => string }) {
  return (
    <nav aria-label="Insights views" className="mb-6 flex flex-wrap gap-1 border-b border-border-soft">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={hrefFor(v.key)}
          aria-current={v.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
            v.key === active
              ? "border-accent text-text-primary"
              : "border-transparent text-text-secondary hover:border-border-strong hover:text-text-primary",
          )}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
