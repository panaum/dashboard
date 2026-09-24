import { db } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { RANKS, type Rank } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { AddMemberButton } from "@/components/forms/dialogs";
import { PreviewAsRank } from "@/components/team/view-as";
import { TeamTable, type MemberRow } from "@/components/team/team-table";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { BoardPerformancePanel } from "@/components/team/board-performance-panel";
import { computeBoardPerformance, monthPeriod } from "@/lib/board-performance";
import { isStage } from "@/lib/boards";

type Stat = { built: number; tested: number; issuesBuilt: number; repetitive: number; issuesFound: number };

export const metadata = { title: "Team" };

export default async function TeamPage() {
  // Admin-only: the team list, and who may do what, is not for everyone.
  const actor = await requireCapability("team:view");


  // This month's board activity, for the second performance panel.
  const month = new Date().toISOString().slice(0, 7);
  const period = monthPeriod(month);
  const [members, pages, boardIssues, boardEvents, pendingRequests] = await Promise.all([
    db.teamMember.findMany({ omit: { avatar: true }, orderBy: { name: "asc" } }),
    db.page.findMany({
      select: {
        developerId: true,
        testerId: true,
        issues: { select: { severity: true } },
      },
    }),
    db.issue.findMany({
      where: { boardStage: { not: null } },
      select: { id: true, assigneeId: true, recurring: true, createdAt: true },
    }),
    db.issueEvent.findMany({
      where: { createdAt: { gte: period.from, lt: period.to } },
      select: { issueId: true, fromStage: true, toStage: true, actorId: true, createdAt: true },
    }),
    db.rankChangeRequest.findMany({
      where: { status: "pending" },
      select: { id: true, requestedById: true, toRank: true, reason: true, createdAt: true },
    }),
  ]);
  const pendingBy = new Map(pendingRequests.map((r) => [r.requestedById, r]));
  const boardPerf = computeBoardPerformance(
    boardIssues,
    boardEvents.flatMap((e) => isStage(e.toStage)
      ? [{ ...e, toStage: e.toStage, fromStage: isStage(e.fromStage) ? e.fromStage : null }] : []),
    period,
  );

  const stats = new Map<string, Stat>();
  const ensure = (id: string) =>
    stats.get(id) ?? stats.set(id, { built: 0, tested: 0, issuesBuilt: 0, repetitive: 0, issuesFound: 0 }).get(id)!;

  for (const p of pages) {
    if (p.developerId) {
      const s = ensure(p.developerId);
      s.built++;
      s.issuesBuilt += p.issues.length;
      s.repetitive += p.issues.filter((i) => i.severity === "REPETITIVE").length;
    }
    if (p.testerId) {
      const s = ensure(p.testerId);
      s.tested++;
      s.issuesFound += p.issues.length;
    }
  }

  const developers = members.filter((m) => stats.get(m.id)?.built);
  const totalBuilt = pages.filter((p) => p.developerId).length;
  const totalIssues = pages.reduce((n, p) => n + p.issues.length, 0);

  const rows: MemberRow[] = members.map((m) => {
    const s = stats.get(m.id);
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      rank: ((RANKS as readonly string[]).includes(m.rank) ? m.rank : "VIEWER") as Rank,
      email: m.email,
      slackUserId: m.slackUserId,
      title: m.title,
      avatarUpdatedAt: m.avatarUpdatedAt?.toISOString() ?? null,
      hasLogin: Boolean(m.email && m.passwordHash),
      isSelf: m.id === actor.id,
      built: s?.built ?? 0,
      tested: s?.tested ?? 0,
      repetitive: s?.repetitive ?? 0,
      nickname: m.nickname,
      pendingRequest: (() => {
        const r = pendingBy.get(m.id);
        return r ? { id: r.id, toRank: r.toRank, reason: r.reason, createdAt: r.createdAt.toISOString() } : null;
      })(),
    };
  });

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Workload and quality across developers and testers."
        action={<div className="flex flex-wrap items-center justify-end gap-3"><PreviewAsRank /><AddMemberButton /></div>}
      />


      <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={members.length} unit="People" index={0} />
        <Stat value={developers.length} unit="Developers" index={1} />
        <Stat value={totalBuilt} unit="Pages built" index={2} />
        <Stat
          value={totalBuilt ? totalIssues / totalBuilt : 0}
          decimals={1}
          unit="Avg issues / page"
          index={3}
        />
      </div>

      {/* The order the operator asked for: the numbers first, then each group
          in its own box — management, QA, developers — behind one filter. */}
      <TeamTable members={rows} />
      <BoardPerformancePanel data={boardPerf} names={new Map(members.map((m) => [m.id, m.name]))} month={month} />
    </>
  );
}

function Stat({
  value,
  unit,
  index = 0,
  decimals = 0,
}: {
  value: number;
  unit: string;
  index?: number;
  decimals?: number;
}) {
  return (
    <div
      className="animate-in rounded-xl border border-border-soft bg-card px-5 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
        {unit}
      </div>
      <div className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
        <AnimatedNumber value={value} decimals={decimals} />
      </div>
    </div>
  );
}
