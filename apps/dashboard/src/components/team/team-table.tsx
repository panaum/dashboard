"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Trash2, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EditMemberButton } from "@/components/forms/dialogs";
import { ConfirmDelete } from "@/components/forms/confirm-delete";
import { deleteMember } from "@/app/dashboard/team/actions";
import { RankSelect } from "@/components/team/rank-select";
import { LoginButton } from "@/components/team/login-button";
import { label } from "@/lib/constants";
import type { Rank } from "@/lib/permissions";

export type MemberRow = {
  id: string;
  name: string;
  role: string;
  rank: Rank;
  email: string | null;
  /** Whether an admin has given this person an email + password yet. */
  hasLogin: boolean;
  /** True for the row of the person currently signed in — they may not demote
   *  themselves, so the control is disabled rather than failing on submit. */
  isSelf: boolean;
  built: number;
  tested: number;
  repetitive: number;
};

const ROW =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_5rem_9.5rem_5.5rem] items-center gap-4";

export function TeamTable({ members }: { members: MemberRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        label(m.role).toLowerCase().includes(term),
    );
  }, [q, members]);

  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or role…"
          className="h-10 w-full rounded-lg border border-border-soft bg-card pl-9 pr-3 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
        <div
          className={`${ROW} border-b border-border-soft px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted`}
        >
          <span>Member</span>
          <span className="text-right">Built</span>
          <span className="text-right">QA&apos;d</span>
          <span className="text-right">Repetitive</span>
          <span className="text-right">Access</span>
          <span />
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-secondary">
            No team members match “{q}”.
          </div>
        ) : (
          filtered.map((m, i) => (
            <div
              key={m.id}
              style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
              className={`${ROW} animate-in border-t border-border-soft px-4 py-3 transition-colors first:border-t-0 hover:bg-card-soft`}
            >
              <Link
                href={`/dashboard/team/${m.id}`}
                className="group flex min-w-0 items-center gap-3"
              >
                <Avatar name={m.name} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                    {m.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      tone={m.role === "TESTER" ? "info" : "neutral"}
                      className="w-fit"
                    >
                      {label(m.role)}
                    </Badge>
                    {!m.hasLogin && (
                      <span className="text-[11px] text-text-muted">no login</span>
                    )}
                  </div>
                </div>
              </Link>
              <span className="text-right text-sm tabular-nums text-text-primary">
                {m.built}
              </span>
              <span className="text-right text-sm tabular-nums text-text-primary">
                {m.tested}
              </span>
              <span
                className={`text-right text-sm tabular-nums ${
                  m.repetitive ? "font-medium text-warning" : "text-text-muted"
                }`}
              >
                {m.repetitive}
              </span>
              <RankSelect
                memberId={m.id}
                rank={m.rank}
                name={m.name}
                disabled={m.isSelf}
                disabledReason="You cannot change your own access level."
              />
              <div className="flex items-center justify-end gap-0.5">
                <LoginButton
                  member={{ id: m.id, name: m.name, email: m.email, hasLogin: m.hasLogin }}
                />
                <EditMemberButton member={{ id: m.id, name: m.name, role: m.role }} />
                <ConfirmDelete
                  action={deleteMember}
                  fields={{ id: m.id }}
                  title="Remove team member"
                  description={`Remove ${m.name}? They'll be unassigned from any pages.`}
                  trigger={
                    <button
                      className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                      aria-label="Delete member"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  }
                />
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
