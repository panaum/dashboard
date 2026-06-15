"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  BarChart3,
  Users,
  UsersRound,
  Building2,
  FolderKanban,
  FileText,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CommandItem = {
  id: string;
  type: "Client" | "Project" | "Page";
  label: string;
  sublabel?: string;
  href: string;
};

type Entry = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  tag: string;
  icon: LucideIcon;
};

const ACTIONS: Entry[] = [
  { key: "a-overview", label: "Overview", href: "/dashboard", tag: "Go to", icon: LayoutDashboard },
  { key: "a-monthly", label: "Monthly report", href: "/dashboard/reports", tag: "Go to", icon: BarChart3 },
  { key: "a-clients", label: "Clients", href: "/dashboard/clients", tag: "Go to", icon: Users },
  { key: "a-team", label: "Team", href: "/dashboard/team", tag: "Go to", icon: UsersRound },
  { key: "a-search", label: "Advanced search", href: "/dashboard/search", tag: "Go to", icon: Search },
];

const TYPE_ICON: Record<CommandItem["type"], LucideIcon> = {
  Client: Building2,
  Project: FolderKanban,
  Page: FileText,
};

function rank(text: string, q: string): number {
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i < 0) return -1;
  if (t === q) return 3;
  if (i === 0) return 2;
  return 1;
}

export function CommandPalette({ items }: { items: CommandItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(
    () =>
      items.map((it) => ({
        key: it.id,
        label: it.label,
        sublabel: it.sublabel,
        href: it.href,
        tag: it.type,
        icon: TYPE_ICON[it.type],
      })),
    [items],
  );

  const results = useMemo<Entry[]>(() => {
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) return ACTIONS;
    const searchEverywhere: Entry = {
      key: "search-all",
      label: `Search everywhere for “${raw}”`,
      href: `/dashboard/search?q=${encodeURIComponent(raw)}`,
      tag: "Search",
      icon: Search,
    };
    const actionHits = ACTIONS.filter((a) => a.label.toLowerCase().includes(q));
    const itemHits = entries
      .map((e) => ({
        e,
        s: Math.max(rank(e.label, q), e.sublabel ? rank(e.sublabel, q) - 1 : -1),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.e.label.length - b.e.label.length)
      .slice(0, 40)
      .map((x) => x.e);
    return [searchEverywhere, ...actionHits, ...itemHits];
  }, [query, entries]);

  useEffect(() => setActive(0), [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const select = useCallback(
    (entry: Entry | undefined) => {
      if (!entry) return;
      close();
      router.push(entry.href);
    },
    [close, router],
  );

  // Global open: Cmd/Ctrl+K, or a window event from the sidebar trigger.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("command-palette:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("command-palette:open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={close}
    >
      <div className="absolute inset-0 bg-brand-primary/25 backdrop-blur-sm" />
      <div
        className="animate-cmd-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-border-soft bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-border-soft px-4">
          <Search className="size-[18px] shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients, projects, pages…"
            className="h-12 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="hidden shrink-0 rounded-md border border-border-soft px-1.5 py-0.5 text-[11px] font-medium text-text-muted sm:block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-text-secondary">
              No matches for “{query}”.
            </div>
          ) : (
            results.map((r, i) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  data-idx={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => select(r)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    i === active ? "bg-brand-purple/15" : "hover:bg-card-soft",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      i === active
                        ? "bg-brand-purple/25 text-brand-primary"
                        : "bg-card-soft text-text-secondary",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {r.label}
                    </span>
                    {r.sublabel && (
                      <span className="truncate text-[12px] text-text-secondary">
                        {r.sublabel}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                    {r.tag}
                  </span>
                  {i === active && (
                    <CornerDownLeft className="size-3.5 shrink-0 text-text-muted" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
