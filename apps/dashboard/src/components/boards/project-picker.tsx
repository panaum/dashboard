"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// STARTING A BOARD IS A SEARCH, NOT A LIST.
//
// This used to be every project in the workspace rendered as a chip, capped at
// 50 — so 118 of 168 projects were not on the page at all, and nothing said
// so. A project you went looking for alphabetically after the cut simply did
// not exist as far as the page was concerned.
//
// A search has no such cliff: it is the same control at 168 projects and at
// 1,000. The whole list ships to the client because it is two short strings
// per project and filtering on the server would cost a round trip per
// keystroke for no gain at this size.

export type PickableProject = { id: string; name: string; client: string };

export function ProjectPicker({ projects }: { projects: PickableProject[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return projects.slice(0, 8);
    return projects
      .filter((p) => `${p.client} ${p.name}`.toLowerCase().includes(term))
      .slice(0, 40);
  }, [q, projects]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border-soft bg-card px-3.5 py-2 text-[13px] font-medium text-text-primary shadow-xs transition-colors hover:border-accent/50 hover:bg-accent/[0.06]"
      >
        <Plus className="size-4" strokeWidth={2} />
        Start a board
        <span className="text-text-muted">{projects.length} projects</span>
      </button>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setQ(""); }
            if (e.key === "Enter" && matches[0]) router.push(`/dashboard/boards/${matches[0].id}`);
          }}
          placeholder="Search a project to start its board…"
          aria-label="Search a project to start its board"
          className="h-10 w-full rounded-lg border border-border-soft bg-card pl-9 pr-9 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
        <button
          type="button"
          onClick={() => { setOpen(false); setQ(""); }}
          aria-label="Close"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-text-secondary hover:bg-card-soft"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="mt-2 overflow-hidden rounded-lg border border-border-soft bg-card">
        {matches.length === 0 ? (
          <li className="px-3 py-6 text-center text-[13px] text-text-secondary">
            No project matches “{q}”.
          </li>
        ) : (
          matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => router.push(`/dashboard/boards/${p.id}`)}
                className={cn(
                  "flex w-full items-baseline gap-2 border-t border-border-soft px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-card-soft",
                  i === 0 && q.trim() && "bg-accent/[0.05]",
                )}
              >
                <span className="truncate text-[13px] font-medium text-text-primary">{p.name}</span>
                <span className="truncate text-[12px] text-text-secondary">{p.client}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      {!q.trim() && projects.length > matches.length && (
        <p className="mt-2 text-[12px] text-text-muted">
          Showing {matches.length} of {projects.length}. Type to search the rest.
        </p>
      )}
    </div>
  );
}
