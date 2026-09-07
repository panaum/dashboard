"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Trash2, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { CheckRunner } from "@/components/layout-checks/check-runner";
import { removeLayoutSite } from "@/app/dashboard/layout-checks/actions";
import {
  devicesChip, displayName, filterRows, lastCheckedWords, listSummary, sortRows,
  thumbSrc, viewportsChip, type ListRow, type SortMode,
} from "@/lib/layout-checks/list-view";

// The list of pages being watched. Three questions, answered without clicking:
// which pages are broken, when each was last looked at, and what it looks like.
// Everything else — searching, re-sorting, running a check — happens here too,
// so the list is somewhere you work rather than a table of contents.

const SORTS: { key: SortMode; label: string }[] = [
  { key: "worst", label: "Worst first" },
  { key: "recent", label: "Recently checked" },
  { key: "name", label: "Name" },
];

export function PagesList({ rows }: { rows: ListRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortMode>("worst");
  const shown = useMemo(() => sortRows(filterRows(rows, q), sort), [rows, q, sort]);
  const summary = listSummary(rows);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-text-secondary">{summary}</p>

        <div className="flex items-center gap-2">
          {rows.length > 3 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                type="search"
                placeholder="Search pages"
                aria-label="Search pages"
                className="h-9 w-52 rounded-lg border border-border-soft bg-card pl-8 pr-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
              />
            </div>
          )}
          <div className="flex rounded-lg border border-border-soft bg-card p-0.5" role="group" aria-label="Sort pages">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                  sort === s.key ? "bg-accent/10 text-accent" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border-soft bg-card px-5 py-8 text-center text-sm text-text-secondary">
          No page matches “{q}”.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border-soft bg-card">
          {shown.map((row, i) => (
            <PageRow key={row.id} row={row} first={i === 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PageRow({ row, first }: { row: ListRow; first: boolean }) {
  const href = `/dashboard/layout-checks/${row.id}`;
  const src = thumbSrc(row.thumb);
  const v = viewportsChip(row.viewports);
  const d = devicesChip(row.devices);
  const name = displayName(row);

  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 transition-colors hover:bg-card-soft", !first && "border-t border-border-soft")}>
      {/* The picture is the fastest way to recognise a page, so it is the first
          thing in the row and part of the link, not decoration beside it. */}
      <Link href={href} className="group flex min-w-0 flex-1 items-center gap-3.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-soft bg-card-soft">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" aria-hidden className="h-full w-full object-cover object-top" />
          ) : (
            <MonitorSmartphone className="size-4 text-text-muted" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-text-primary group-hover:underline">{name}</span>
          <span className="truncate text-[12px] text-text-muted">{row.url}</span>
          <span className="mt-0.5 text-[11.5px] text-text-muted">{lastCheckedWords(row)}</span>
        </span>
      </Link>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Widths</span>
          <Badge tone={v.tone}>{v.label}</Badge>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Devices</span>
          <Badge tone={d.tone}>{d.label}</Badge>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <CheckRunner url={row.url} label="Run widths" size="sm" variant="secondary" />
        <ConfirmDelete
          action={removeLayoutSite}
          fields={{ id: row.id }}
          title="Stop watching this page"
          description={`Remove ${name}? Its check history and screenshots go with it.`}
          trigger={
            <button
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`Remove ${name}`}
            >
              <Trash2 className="size-4" />
            </button>
          }
        />
      </div>
    </li>
  );
}
