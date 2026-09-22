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
import { compareManagement, memberLabel } from "@/lib/designations";
import { buildsPages, doesPageWork, testsPages } from "@/lib/roles";
import { Managers } from "@/components/team/managers";
import type { Rank } from "@/lib/permissions";

export type MemberRow = {
  id: string;
  name: string;
  role: string;
  rank: Rank;
  email: string | null;
  slackUserId: string | null;
  /** What it says on their card — shown under the name when set. */
  title: string | null;
  /** ISO timestamp of the current photo, or null. Doubles as the cache key. */
  avatarUpdatedAt: string | null;
  /** Whether an admin has given this person an email + password yet. */
  hasLogin: boolean;
  /** True for the row of the person currently signed in — they may not demote
   *  themselves, so the control is disabled rather than failing on submit. */
  isSelf: boolean;
  built: number;
  tested: number;
  repetitive: number;
};

// ONE BOX PER KIND OF WORK.
//
// This was a single table with Built, QA'd and Repetitive on every row, which
// meant a QA carried two columns that could only ever be a dash and a
// developer carried one. Splitting the groups lets each box show only the
// numbers that mean something in it, so there are no dashes left to explain.
//
// One filter above the lot: typing a name should find that person wherever
// they sit, not just in the box you happen to be looking at.

type Metric = { head: string; get: (m: MemberRow) => number; warnWhenSet?: boolean };

const BUILD_METRICS: Metric[] = [
  { head: "Built", get: (m) => m.built },
  { head: "Repetitive", get: (m) => m.repetitive, warnWhenSet: true },
];
const QA_METRICS: Metric[] = [{ head: "QA'd", get: (m) => m.tested }];

export function TeamTable({ members }: { members: MemberRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        memberLabel(m).toLowerCase().includes(term),
    );
  }, [q, members]);

  // Seniority, not the alphabet — CEO first. The page used to sort this
  // before handing it over; the grouping lives here now, so the sort does too.
  const managers = filtered.filter((m) => !doesPageWork(m.role)).sort(compareManagement);
  const qa = filtered.filter((m) => testsPages(m.role) && !buildsPages(m.role));
  const devs = filtered.filter((m) => buildsPages(m.role));

  return (
    <>
      {/* One filter, above everything: typing a name should find that person
          wherever they sit, not only in the box you happen to be looking at. */}
      <div className="relative mb-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or role…"
          className="h-10 w-full rounded-lg border border-border-soft bg-card pl-9 pr-3 text-sm text-text-primary shadow-xs outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
      </div>

      <div className="flex flex-col gap-6">
        {/* Management has no metric columns at all — they neither build nor
            QA — so it keeps its own layout rather than an empty grid. */}
        {(managers.length > 0 || !q.trim()) && (
          <section>
            <GroupHeading title="Management" count={managers.length} />
            <Managers members={managers} />
          </section>
        )}
        <Group title="QA" members={qa} metrics={QA_METRICS} term={q} />
        <Group title="Developers" members={devs} metrics={BUILD_METRICS} term={q} />
      </div>
    </>
  );
}

function Group({
  title, members, metrics, term,
}: {
  title: string;
  members: MemberRow[];
  metrics: Metric[];
  term: string;
}) {
  // The columns are built from the metric list, so a box never has to leave
  // room for a number it does not carry.
  const grid = {
    gridTemplateColumns: `minmax(0,1fr) ${metrics.map(() => "6rem").join(" ")} 9.5rem 5.5rem`,
  };
  const row = "grid items-center gap-4 px-4";

  if (members.length === 0 && term.trim()) return null;

  return (
    <section>
      <GroupHeading title={title} count={members.length} />

      <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
        <div
          style={grid}
          className={`${row} border-b border-border-soft py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted`}
        >
          <span>Member</span>
          {metrics.map((m) => (
            <span key={m.head} className="text-right">{m.head}</span>
          ))}
          <span className="text-right">Access</span>
          <span />
        </div>

        {members.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            Nobody here yet.
          </div>
        ) : (
          members.map((m, i) => (
            <div
              key={m.id}
              style={{ ...grid, animationDelay: `${Math.min(i, 14) * 30}ms` }}
              className={`${row} animate-in border-t border-border-soft py-3 transition-colors first:border-t-0 hover:bg-card-soft`}
            >
              <Link
                href={`/dashboard/team/${m.id}`}
                className="group flex min-w-0 items-center gap-3"
              >
                <Avatar
                  name={m.name}
                  src={m.avatarUpdatedAt ? `/api/team-avatar?id=${m.id}&v=${encodeURIComponent(m.avatarUpdatedAt)}` : null}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary group-hover:underline">
                    {m.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* One label, not two. It used to be the designation AND
                        the role badge side by side, which said the same thing
                        twice for everyone whose title matched their work. */}
                    <Badge tone={m.role === "TESTER" ? "info" : "neutral"} className="w-fit">
                      {memberLabel(m)}
                    </Badge>
                    {!m.hasLogin && (
                      <span className="text-[11px] text-text-muted">no login</span>
                    )}
                  </div>
                </div>
              </Link>

              {metrics.map((metric) => {
                const value = metric.get(m);
                return (
                  <span
                    key={metric.head}
                    className={`text-right text-sm tabular-nums ${
                      metric.warnWhenSet && value
                        ? "font-medium text-warning-strong"
                        : "text-text-primary"
                    }`}
                  >
                    {value}
                  </span>
                );
              })}

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
                <EditMemberButton
                  member={{ id: m.id, name: m.name, role: m.role, title: m.title, slackUserId: m.slackUserId, avatarUpdatedAt: m.avatarUpdatedAt }}
                />
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
    </section>
  );
}

function GroupHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
      {title}
      <span className="ml-2 font-normal normal-case tracking-normal tabular-nums text-text-muted">
        {count}
      </span>
    </h2>
  );
}
