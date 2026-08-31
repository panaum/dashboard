import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { label, MONTH_NAMES } from "@/lib/constants";

const shortMonth = (m: string) =>
  MONTH_NAMES[Number(m.slice(5, 7)) - 1]?.slice(0, 3) ?? m.slice(5);

function Stat({ value, unit }: { value: string | number; unit: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-card px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-muted">
        {unit}
      </div>
      <div className="mt-2.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
        {value}
      </div>
    </div>
  );
}

const pageInclude = {
  project: { include: { client: true } },
  issues: { select: { severity: true } },
} as const;

function PageRow({
  pg,
}: {
  pg: {
    id: string;
    name: string;
    projectId: string;
    deliveryMonth: string | null;
    project: { clientId: string; client: { name: string } };
    issues: { severity: string }[];
  };
}) {
  return (
    <Link
      href={`/dashboard/clients/${pg.project.clientId}/${pg.projectId}/${pg.id}`}
    >
      <Card hover className="flex items-center gap-3 p-3">
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-medium text-text-primary">{pg.name}</span>
          <span className="text-xs text-text-secondary">
            {pg.project.client.name} · {pg.deliveryMonth ?? "—"}
          </span>
        </div>
        <Badge tone={pg.issues.length > 0 ? "warning" : "success"}>
          {pg.issues.length} issue{pg.issues.length === 1 ? "" : "s"}
        </Badge>
      </Card>
    </Link>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const m = await db.teamMember.findUnique({
    where: { id: memberId },
    select: { name: true },
  });
  return { title: m?.name ?? "Team member" };
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const member = await db.teamMember.findUnique({
    where: { id: memberId },
    include: {
      devPages: { include: pageInclude, orderBy: { deliveryMonth: "asc" } },
      testerPages: { include: pageInclude, orderBy: { deliveryMonth: "asc" } },
    },
  });
  if (!member) notFound();

  const built = member.devPages;
  const tested = member.testerPages;
  const issuesBuilt = built.reduce((n, p) => n + p.issues.length, 0);
  const repetitive = built.reduce(
    (n, p) => n + p.issues.filter((i) => i.severity === "REPETITIVE").length,
    0,
  );
  const issuesFound = tested.reduce((n, p) => n + p.issues.length, 0);

  // Pages built per month (the quality-trend signal from the sheet).
  const months = [...new Set(built.map((p) => p.deliveryMonth).filter(Boolean))].sort() as string[];
  const perMonth = months.map((m) => ({
    month: m,
    count: built.filter((p) => p.deliveryMonth === m).length,
    rep: built
      .filter((p) => p.deliveryMonth === m)
      .reduce((n, p) => n + p.issues.filter((i) => i.severity === "REPETITIVE").length, 0),
  }));
  const maxCount = Math.max(1, ...perMonth.map((p) => p.count));

  return (
    <>
      <Breadcrumbs items={[{ label: "Team", href: "/dashboard/team" }, { label: member.name }]} />
      <div className="mb-7 flex items-center gap-4">
        <Avatar name={member.name} size="lg" />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-none tracking-tight text-text-primary">
            {member.name}
          </h1>
          <Badge
            tone={member.role === "TESTER" ? "info" : "neutral"}
            className="w-fit"
          >
            {label(member.role)}
          </Badge>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat value={built.length} unit="Pages built" />
        <Stat value={tested.length} unit="Pages QA'd" />
        <Stat value={built.length ? (issuesBuilt / built.length).toFixed(1) : "0"} unit="Avg issues / build" />
        <Stat value={repetitive} unit="Repetitive bugs" />
      </div>

      {perMonth.length > 0 && (
        <Card className="mb-6 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-text-primary">
              Pages built per month
            </h2>
            <span className="text-[13px] tabular-nums text-text-muted">
              {built.length} total
            </span>
          </div>
          <div
            className="flex items-end gap-3 border-b border-border-soft"
            style={{ height: 116 }}
          >
            {perMonth.map((p) => {
              const h = Math.max(6, Math.round((p.count / maxCount) * 92));
              return (
                <div
                  key={p.month}
                  className="flex flex-1 flex-col items-center justify-end gap-1.5"
                  title={`${p.count} built · ${p.rep} repetitive`}
                >
                  <span className="text-xs font-semibold tabular-nums text-text-primary">
                    {p.count}
                  </span>
                  <div
                    className="w-full max-w-[44px] rounded-t-md bg-accent transition-colors hover:bg-accent-bright"
                    style={{ height: h }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-3">
            {perMonth.map((p) => (
              <span
                key={p.month}
                className="flex-1 text-center text-[11px] font-medium text-text-muted"
              >
                {shortMonth(p.month)}
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">
            Built <span className="text-sm font-normal text-text-secondary">({built.length})</span>
          </h2>
          <div className="flex flex-col gap-2">
            {built.map((pg) => <PageRow key={pg.id} pg={pg} />)}
            {built.length === 0 && <p className="text-sm text-text-secondary">No pages built.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">
            QA&apos;d{" "}
            <span className="text-sm font-normal text-text-secondary">
              ({tested.length} · {issuesFound} issues found)
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {tested.map((pg) => <PageRow key={pg.id} pg={pg} />)}
            {tested.length === 0 && <p className="text-sm text-text-secondary">No pages QA&apos;d.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
