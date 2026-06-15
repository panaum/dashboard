import type { LucideIcon } from "lucide-react";

/** Friendly empty state with an icon, message and an optional next-step action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-soft bg-card px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-card-soft text-text-muted">
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
