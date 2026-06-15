export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-tight text-text-primary">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
