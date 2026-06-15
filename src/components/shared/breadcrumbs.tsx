import Link from "next/link";
import { ChevronRight, ArrowLeft } from "lucide-react";

export function Breadcrumbs({
  items: rawItems,
}: {
  items: { label: string; href?: string }[];
}) {
  // Collapse consecutive duplicate labels (e.g. landing pages where the client,
  // project and page all share one name) so a crumb never repeats itself.
  // Keep one crumb per run, carrying the deepest available link target.
  const items: { label: string; href?: string }[] = [];
  for (const item of rawItems) {
    const prev = items[items.length - 1];
    if (prev && prev.label === item.label) {
      prev.href = item.href ?? prev.href;
      continue;
    }
    items.push({ ...item });
  }

  // The nearest ancestor with a link — where "Back" should go.
  const parent = [...items].slice(0, -1).reverse().find((i) => i.href);

  return (
    <div className="mb-3 flex items-center gap-2">
      {parent?.href && (
        <Link
          href={parent.href}
          aria-label={`Back to ${parent.label}`}
          title={`Back to ${parent.label}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-soft bg-card text-text-secondary shadow-xs transition-colors hover:border-brand-purple/40 hover:text-text-primary"
        >
          <ArrowLeft className="size-4" />
        </Link>
      )}
      <nav className="flex items-center gap-1 text-[13px] text-text-secondary">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-text-primary">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-text-primary" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 text-text-muted" />}
            </span>
          );
        })}
      </nav>
    </div>
  );
}
