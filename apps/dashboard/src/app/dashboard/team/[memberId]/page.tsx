import Link from "next/link";
import { Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { MONTH_NAMES } from "@/lib/constants";
import { memberLabel } from "@/lib/designations";
import { buildsPages, doesPageWork, testsPages } from "@/lib/roles";
import { groupByClient, groupSummary } from "@/lib/team-pages";
import { ChevronRight } from "lucide-react";

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

/**
 * One client, collapsed. A QA with 145 pages had 145 rows on this page, which
 * is a list nobody reads; the client is the unit people think in, and the
 * pages are the detail behind it.
 *
 * <details> rather than state: this is a Server Component, and the browser
 * already does disclosure properly — keyboard, screen reader, and each group
 * independent of the others, for no JavaScript at all.
 */
function ClientGroup({
  group,
}: {
  group: { clientId: string; client: string; pages: PageForRow[]; issues: number };
}) {
  return (
    <details className="group overflow-hidden rounded-xl border border-border-soft bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-card-soft">
        <ChevronRight
          className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-90"
          strokeWidth={2}
        />
        <span className="flex-1 truncate text-sm font-medium text-text-primary">
          {group.client}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-text-secondary">
          {groupSummary(group.pages.length, group.issues)}
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-border-soft bg-card-soft/40 p-3">
        {group.pages.map((pg) => <PageRow key={pg.id} pg={pg} />)}
      </div>
    </details>
  );
}

type PageForRow = {
  id: string;
  name: string;
  projectId: string;
  deliveryMonth: string | null;
  project: { clientId: string; client: { name: string } };
  issues: { severity: string }[];
};

function PageRow({
  pg,
}: {
  pg: PageForRow;
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
    // The photo's bytes are served by /api/team-avatar; they have no business
    // being fetched into a page render.
    omit: { avatar: true },
    include: {
      devPages: { include: pageInclude, orderBy: { deliveryMonth: "asc" } },
      testerPages: { include: pageInclude, orderBy: { deliveryMonth: "asc" } },
    },
  });
  if (!member) notFound();
  // Everything below this line measures pages built and pages QA'd. For
  // somebody who does neither, the page is not an empty state — it is four
  // zeros and a chart of nothing, presented as their record. They are named on
  // the team page instead, and nothing links here.
  if (!doesPageWork(member.role)) notFound();

  const built = member.devPages;
  const tested = member.testerPages;
  const issuesBuilt = built.reduce((n, p) => n + p.issues.length, 0);
  const repetitive = built.reduce(
    (n, p) => n + p.issues.filter((i) => i.severity === "REPETITIVE").length,
    0,
  );
  const issuesFound = tested.reduce((n, p) => n + p.issues.length, 0);

  // WHAT THIS PERSON'S ROLE EARNS THEM ON THIS PAGE.
  //
  // A QA does not build, so "Pages built" was a zero, and "Avg issues / build"
  // and "Repetitive bugs" were zeros derived from that zero — three numbers
  // about work she was never going to do, sitting next to the one that counts.
  // The same in reverse for a developer and the QA'd column. Nobody is BOTH
  // today; when somebody is, they get all of it.
  const builds = buildsPages(member.role);
  const tests = testsPages(member.role);

  const stats: { unit: string; value: string | number }[] = [
    ...(builds
      ? [
          { unit: "Pages built", value: built.length },
          { unit: "Avg issues / build", value: built.length ? (issuesBuilt / built.length).toFixed(1) : "0" },
          { unit: "Repetitive bugs", value: repetitive },
        ]
      : []),
    ...(tests
      ? [
          { unit: "Pages QA'd", value: tested.length },
          { unit: "Issues found", value: issuesFound },
        ]
      : []),
  ];
  // Tailwind needs the whole class name to exist in the source, so this is a
  // lookup rather than a template string.
  const statCols = ["", "md:grid-cols-1", "md:grid-cols-2", "md:grid-cols-3", "md:grid-cols-4"][
    Math.min(stats.length, 4)
  ];

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
      <div className="mb-7 flex flex-wrap items-center gap-4">
        <Avatar
          name={member.name}
          src={member.avatarUpdatedAt ? `/api/team-avatar?id=${member.id}&v=${member.avatarUpdatedAt.toISOString()}` : null}
          size="lg"
        />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-none tracking-tight text-text-primary">
            {member.name}
          </h1>
          {/* One label under the name, the same one the team list shows. */}
          <Badge
            tone={member.role === "TESTER" ? "info" : "neutral"}
            className="w-fit"
          >
            {memberLabel(member)}
          </Badge>
        </div>
        {/* Team answers "who is this person"; Insights answers "how is the
            work going". This is the hop between them, pre-filtered so the
            question carries over instead of being re-typed. */}
        {member.role !== "TESTER" && (
          <Link
            href={`/dashboard/insights?developerId=${member.id}&scope=all`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-card px-4 py-2 text-[13px] font-medium text-text-primary shadow-xs transition-colors hover:border-accent/50 hover:bg-accent/[0.06]"
          >
            <Sparkles className="size-4" strokeWidth={1.75} />
            See their trend in Insights
          </Link>
        )}
      </div>

      <div className={`mb-6 grid grid-cols-2 gap-4 ${statCols}`}>
        {stats.map((s) => <Stat key={s.unit} value={s.value} unit={s.unit} />)}
      </div>

      {builds && perMonth.length > 0 && (
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

      {/* One column each, but only for the work they do — so somebody who only
          QAs gets the full width for it instead of half a page of "No pages
          built." */}
      <div className={`grid gap-6 ${builds && tests ? "lg:grid-cols-2" : ""}`}>
        {builds && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">
              Built{" "}
              <span className="text-sm font-normal text-text-secondary">
                ({built.length} · {issuesBuilt} issue{issuesBuilt === 1 ? "" : "s"})
              </span>
            </h2>
            <PageList pages={built} empty="No pages built." />
          </section>
        )}
        {tests && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-text-primary">
              QA&apos;d{" "}
              <span className="text-sm font-normal text-text-secondary">
                ({tested.length} · {issuesFound} issue{issuesFound === 1 ? "" : "s"} found)
              </span>
            </h2>
            <PageList pages={tested} empty="No pages QA'd." />
          </section>
        )}
      </div>
    </>
  );
}

/** Client first, pages behind a disclosure. */
function PageList({ pages, empty }: { pages: PageForRow[]; empty: string }) {
  if (pages.length === 0) {
    return <p className="text-sm text-text-secondary">{empty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {groupByClient(pages).map((g) => <ClientGroup key={g.clientId} group={g} />)}
    </div>
  );
}
