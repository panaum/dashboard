import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { AddMemberButton } from "@/components/forms/dialogs";
import { TeamTable, type MemberRow } from "@/components/team/team-table";
import { AnimatedNumber } from "@/components/shared/animated-number";

type Stat = { built: number; tested: number; issuesBuilt: number; repetitive: number; issuesFound: number };

export default async function TeamPage() {
  const [members, pages] = await Promise.all([
    db.teamMember.findMany({ orderBy: { name: "asc" } }),
    db.page.findMany({
      select: {
        developerId: true,
        testerId: true,
        issues: { select: { severity: true } },
      },
    }),
  ]);

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
      built: s?.built ?? 0,
      tested: s?.tested ?? 0,
      repetitive: s?.repetitive ?? 0,
    };
  });

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Workload and quality across developers and testers."
        action={<AddMemberButton />}
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

      <TeamTable members={rows} />
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
