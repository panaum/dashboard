"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

export type ClientRow = {
  id: string;
  name: string;
  projects: number;
  pages: number;
};

// PRESENCE: one dot per client, coloured by its worst chip. Loaded after paint
// — the directory must never wait on LinkSpy. A client with no linked site gets
// no entry here and therefore no dot, byte-identical to today.
type Dot = { worst: string; summary: string };

const DOT_COLOR: Record<string, string> = {
  critical: "bg-error",
  warn: "bg-warning",
  notice: "bg-brand-yellow",
  settling: "bg-text-muted/40",
  unknown: "bg-text-muted/40",
  ok: "bg-success",
};

function PresenceDot({ dot }: { dot: Dot | undefined }) {
  if (!dot) return null;
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${DOT_COLOR[dot.worst] ?? "bg-text-muted/40"}`}
      title={`Production: ${dot.summary}`}
      aria-label={`Production status: ${dot.summary}`}
    />
  );
}

export function ClientDirectory({ clients }: { clients: ClientRow[] }) {
  const [q, setQ] = useState("");
  const [dots, setDots] = useState<Record<string, Dot>>({});

  useEffect(() => {
    let live = true;
    fetch("/api/presence/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (live && d?.enabled) setDots(d.clients ?? {}); })
      .catch(() => {}); // quiet: no dots is a valid answer
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(term));
  }, [q, clients]);

  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter clients…"
          className="h-10 w-full rounded-lg border border-border-soft bg-card pl-9 pr-3 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card px-4 py-12 text-center text-sm text-text-secondary">
          No clients match “{q}”.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c, i) => (
            <Link key={c.id} href={`/dashboard/clients/${c.id}`}>
              <Card
                hover
                className="animate-in group flex items-center gap-3 p-3.5"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <Avatar name={c.name} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium text-text-primary">
                    {c.name}
                    <PresenceDot dot={dots[c.id]} />
                  </span>
                  <span className="truncate text-[13px] text-text-secondary">
                    {c.projects} project{c.projects === 1 ? "" : "s"} · {c.pages}{" "}
                    page{c.pages === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
