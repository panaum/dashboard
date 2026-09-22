import Link from "next/link";
import type { CSSProperties } from "react";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { Select } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AnimatedNumber } from "@/components/shared/animated-number";
import { CellTable, Delta, type Column } from "@/components/insights/cell-table";
import { BlockedList, type Blocked } from "@/components/insights/blocked-list";
import { ViewTabs, isView, type ViewKey } from "@/components/insights/view-tabs";
import { buildPageWhere, hasAnyFilter } from "@/lib/page-search";
import { listPlatforms } from "@/lib/platforms";
import { rollingMonths, ROLLING_MONTHS } from "@/lib/team-performance";
import {
  byClient, byPlatform, defectRate, defectRateBy, defectRateByMonth, makePeriod,
  MIN_N, recurrenceRate, testerAdjustedDefectRate, testerCalibration, testerRates,
  weightedDefectRate, type AdjustedCell, type CalibrationCell, type PageRow,
} from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { STATUSES, label, monthLabel } from "@/lib/constants";

/**
 * Insights — restructured around PROCESS, with people as one view of four.
 *
 * What changed, and why it had to:
 *
 * - The default scope was the last three delivery months. That window holds 79
 *   pages and seven developers, some on a single page, and it is where every
 *   misleading number on the old page came from. The default is now all of the
 *   recorded history — 299 pages — and the narrow window is one click away.
 *
 * - Every number comes from src/lib/metrics.ts and nowhere else, so the
 *   sentence at the top and the table underneath cannot disagree about what a
 *   defect rate is. That was the shape of the old bug.
 *
 * - Nothing on this page reads Issue.status. In this database status records
 *   which import a row came from, not whether anything was fixed.
 *
 * - Cells below MIN_N render suppressed rather than ranked, and metrics with
 *   no underlying field render as explicitly blocked rather than as zero.
 */

export const metadata = { title: "Insights" };

type Search = {
  platform?: string;
  status?: string;
  developerId?: string;
  testerId?: string;
  month?: string;
  /** "window" narrows to the rolling months; anything else is all time. */
  scope?: string;
  view?: string;
  /** People view only: show the raw, confounded rate instead of the adjusted. */
  raw?: string;
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { scope, view, raw, ...sp } = await searchParams;
  const windowed = scope === "window";
  const showRaw = raw === "1";
  const active: ViewKey = isView(view) ? view : "process";

  const [members, clients, monthRows, platformOptions, rows] = await Promise.all([
    db.teamMember.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    db.client.findMany({ select: { id: true, name: true } }),
    db.page.findMany({
      where: { deliveryMonth: { not: null } },
      distinct: ["deliveryMonth"],
      select: { deliveryMonth: true },
      orderBy: { deliveryMonth: "desc" },
    }),
    listPlatforms(),
    // Everything matching the filters, unsliced by month: the metric layer
    // does its own period arithmetic and needs the PREVIOUS period in the same
    // array to compute a comparison. 300 pages, so this is cheap.
    db.page.findMany({
      where: buildPageWhere(sp),
      select: {
        id: true,
        deliveryMonth: true,
        developerId: true,
        testerId: true,
        delayDays: true,
        project: { select: { platform: true, clientId: true } },
        // No `status`. See the header comment.
        issues: { select: { severity: true, recurring: true } },
      },
    }),
  ]);

  const allMonths = monthRows.map((m) => m.deliveryMonth!).filter(Boolean);
  const windowMonths = rollingMonths(allMonths);
  const period = sp.month
    ? makePeriod([sp.month], monthLabel(sp.month))
    : windowed
      ? makePeriod(windowMonths, `Last ${ROLLING_MONTHS} months`)
      : makePeriod(allMonths, "All recorded history");

  const pages: PageRow[] = rows.map((p) => ({
    id: p.id,
    deliveryMonth: p.deliveryMonth,
    developerId: p.developerId,
    testerId: p.testerId,
    platform: p.project.platform,
    clientId: p.project.clientId,
    issues: p.issues,
  }));

  const nameOf = new Map(members.map((m) => [m.id, m.name] as const));
  const clientName = new Map(clients.map((c) => [c.id, c.name] as const));

  const rate = defectRate(pages, period);
  const weighted = weightedDefectRate(pages, period);
  const recurrence = recurrenceRate(pages, period);

  // Links keep every other parameter, so switching view never silently
  // widens or narrows what you are looking at.
  const base = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  );
  if (windowed) base.set("scope", "window");
  const href = (over: Record<string, string | null>) => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return `/dashboard/insights${s ? `?${s}` : ""}`;
  };
  const exportHref = `/dashboard/insights/export?${new URLSearchParams({
    ...Object.fromEntries(base),
    ...(windowed ? {} : { scope: "all" }),
  }).toString()}`;

  const fieldCls = "w-auto text-[13px]";

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Where defects concentrate, and how confident we are about each number."
      />

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        {windowed && <input type="hidden" name="scope" value="window" />}
        {active !== "process" && <input type="hidden" name="view" value={active} />}
        <Select name="platform" defaultValue={sp.platform ?? ""} className={fieldCls}>
          <option value="">Any platform</option>
          {platformOptions.map((p) => <option key={p} value={p}>{label(p)}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className={fieldCls}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select name="developerId" defaultValue={sp.developerId ?? ""} className={fieldCls}>
          <option value="">Any developer</option>
          {members.filter((m) => m.role !== "TESTER" && m.role !== "MANAGER")
            .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select name="testerId" defaultValue={sp.testerId ?? ""} className={fieldCls}>
          <option value="">Any tester</option>
          {members.filter((m) => m.role === "TESTER" || m.role === "BOTH")
            .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select name="month" defaultValue={sp.month ?? ""} className={fieldCls}>
          <option value="">Any month</option>
          {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Button type="submit" size="sm">Apply</Button>
        {hasAnyFilter(sp) && (
          <Link href={href({ platform: null, status: null, developerId: null, testerId: null, month: null })}
            className="px-2 py-2 text-[13px] text-text-secondary hover:text-text-primary">
            Clear
          </Link>
        )}
        {pages.length > 0 && (
          <a href={exportHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}>
            <Download /> Export CSV
          </a>
        )}
      </form>

      <p className="mb-6 text-[13px] text-text-secondary">
        {period.label} · {rate.n} page{rate.n === 1 ? "" : "s"}
        {!sp.month && (
          <>
            {" · "}
            <Link href={href(windowed ? { scope: null } : { scope: "window" })}
              className="rounded-xs font-medium text-accent hover:underline">
              {windowed ? "All recorded history" : `Last ${ROLLING_MONTHS} months`}
            </Link>
          </>
        )}
      </p>

      <ViewTabs active={active} hrefFor={(v) => href({ view: v === "process" ? null : v })} />

      {rate.n === 0 ? (
        <div className="rounded-xl border border-border-soft bg-card px-4 py-16 text-center">
          <p className="text-sm text-text-secondary">No pages match these filters in this scope.</p>
        </div>
      ) : active === "process" ? (
        <ProcessView {...{ pages, period, rate, weighted, recurrence, href }} />
      ) : active === "clients" ? (
        <ClientsView {...{ pages, period }} nameOf={clientName} />
      ) : active === "people" ? (
        <PeopleView {...{ pages, period, showRaw, href }} nameOf={nameOf} />
      ) : (
        <DeliveryView rows={rows} period={period} />
      )}
    </>
  );
}

// ─── process ────────────────────────────────────────────────────────────────

const PROCESS_BLOCKED: Blocked[] = [
  {
    metric: "Defect concentration by issue type",
    because: "Issues have no type or category, and 99.8% of titles are placeholders with no description, so nothing can be derived from the text either.",
    unblockedBy: "Issue.type, captured when the issue is raised",
  },
  {
    metric: "Checklist yield and zero-yield items",
    because: "The checklist records 30 failures across 39 items in nine months — 94% of the 11,466 rows are N/A.",
    unblockedBy: "checklist items actually answered, plus Issue.checklistItemId",
  },
  {
    metric: "Coverage gaps",
    because: "A gap is a recurring issue signature with no checklist item behind it. Both halves are missing.",
    unblockedBy: "Issue.type and Issue.checklistItemId",
  },
  {
    metric: "Rework rate and QA rounds",
    because: "One certificate per page is enforced by the schema, so a second QA pass cannot be recorded.",
    unblockedBy: "a round number on the certificate",
  },
  {
    metric: "Cycle time by stage",
    because: "A page stores only a delivery month — no brief, build-start or QA-start timestamp.",
    unblockedBy: "Page.buildStartedAt and Page.qaStartedAt",
  },
];

function ProcessView({
  pages, period, rate, weighted, recurrence, href,
}: {
  pages: PageRow[];
  period: ReturnType<typeof makePeriod>;
  rate: ReturnType<typeof defectRate>;
  weighted: ReturnType<typeof defectRate>;
  recurrence: ReturnType<typeof defectRate>;
  href: (o: Record<string, string | null>) => string;
}) {
  const platforms = defectRateBy(pages, period, byPlatform);
  const rankable = platforms.filter((c) => c.confidence === "high");
  const months = defectRateByMonth(pages, period);
  const maxMonth = Math.max(1, ...months.map((m) => m.value ?? 0));

  return (
    <div className="flex flex-col gap-8">
      {/* In-flight risk is what this page most needs and least has. Saying so
          in the position it would occupy is the honest version of a
          leading-indicator strip. */}
      <BlockedList
        title="In-flight risk — not available"
        items={[{
          metric: "Pages on QA round ≥3, stuck in QA, or heading for a bad platform",
          because: "Every one of these needs a QA round number or a stage timestamp, and neither is recorded anywhere.",
          unblockedBy: "QA rounds on the certificate, and Page.qaStartedAt",
        }]}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Pages" value={rate.n} />
        <Tile label="Issues / page" value={rate.value} decimals={2} prev={rate.previousPeriodValue} />
        <Tile label="Weighted / page" value={weighted.value} decimals={2}
              note="severity-weighted" prev={weighted.previousPeriodValue} />
        <Tile label="Repeat defects" value={recurrence.value} decimals={1} suffix="%"
              note={`of ${recurrence.n} issues`} prev={recurrence.previousPeriodValue} />
      </div>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Where defects concentrate</h2>
        <p className="mb-3 text-[13px] text-text-secondary">
          Platform has an order of magnitude more pages per cell than any person does.
          {rankable.length < platforms.length && (
            <> {platforms.length - rankable.length} of {platforms.length} platforms are below {MIN_N} pages and are not ranked.</>
          )}
        </p>
        <CellTable cells={platforms} label={(k) => label(k)} unit="issues / pg" />
      </section>

      {months.length > 1 && (
        <section className="rounded-xl border border-border-soft bg-card p-5">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">Quality trend</h2>
          <p className="mb-4 text-[13px] text-text-secondary">Issues per page, by delivery month.</p>
          <div className="flex items-end gap-3" style={{ height: 130 }}>
            {months.map((m, i) => {
              const h = Math.max(6, Math.round(((m.value ?? 0) / maxMonth) * 96));
              return (
                <div key={m.key} className="group/bar flex flex-1 flex-col items-center justify-end gap-1.5"
                     title={`${m.value} issues/page over ${m.n} pages`}>
                  <span className="text-[11px] font-semibold tabular-nums text-text-primary">{m.value}</span>
                  <div
                    className={cn("animate-grow w-full max-w-[40px] rounded-t-md transition-colors",
                      m.confidence === "high" ? "bg-accent group-hover/bar:bg-accent-bright" : "bg-border-strong")}
                    style={{ "--bar-h": `${h}px`, animationDelay: `${i * 60}ms` } as CSSProperties}
                  />
                  <span className="text-[11px] text-text-muted">{monthLabel(m.key).slice(0, 3)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <BlockedList title="Not measurable with what we record" items={PROCESS_BLOCKED} />

      <p className="text-[13px] text-text-muted">
        Looking for the people view? It is{" "}
        <Link href={href({ view: "people" })} className="font-medium text-accent hover:underline">one tab across</Link>,
        deliberately — a per-person rate has the thinnest evidence on this page.
      </p>
    </div>
  );
}

// ─── clients ────────────────────────────────────────────────────────────────

function ClientsView({
  pages, period, nameOf,
}: {
  pages: PageRow[];
  period: ReturnType<typeof makePeriod>;
  nameOf: Map<string, string>;
}) {
  const cells = defectRateBy(pages, period, byClient);
  const rankable = cells.filter((c) => c.confidence === "high");
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Defect rate by client</h2>
        <p className="mb-3 text-[13px] text-text-secondary">
          {rankable.length} of {cells.length} clients have {MIN_N} or more delivered pages. The rest are
          shown but not ranked — most accounts here are one or two pages, which is not a trend.
        </p>
        <CellTable cells={cells} label={(k) => nameOf.get(k) ?? k} unit="issues / pg" />
      </section>
      <BlockedList
        title="The commercial half is blocked"
        items={[{
          metric: "Unbilled rework per client",
          because: "Rework means a second QA round, and the schema allows exactly one certificate per page.",
          unblockedBy: "a round number on the certificate",
        }]}
      />
    </div>
  );
}

// ─── people ─────────────────────────────────────────────────────────────────

function PeopleView({
  pages, period, showRaw, nameOf, href,
}: {
  pages: PageRow[];
  period: ReturnType<typeof makePeriod>;
  showRaw: boolean;
  nameOf: Map<string, string>;
  href: (o: Record<string, string | null>) => string;
}) {
  const adjusted = testerAdjustedDefectRate(pages, period);
  const testers = testerCalibration(pages, period);
  const usable = testerRates(pages, period).filter((t) => t.pages >= MIN_N).length;
  const name = (k: string) => nameOf.get(k) ?? k;

  const devCols: Column<AdjustedCell>[] = [
    { head: "pages", render: (c) => <span className="tabular-nums text-text-secondary">{c.n}</span> },
    { head: "raw", render: (c) => <span className="tabular-nums text-text-secondary">{c.raw ?? "—"}</span> },
    {
      head: showRaw ? "raw" : "adjusted",
      render: (c) => (
        <span className="font-medium tabular-nums text-text-primary">
          {(showRaw ? c.raw : c.value) ?? "—"}
        </span>
      ),
    },
    {
      head: "reviewers",
      render: (c) => (
        <span className="text-[12px] text-text-secondary">
          {c.coverage.slice(0, 2).map((cv) => `${name(cv.testerId).split(" ")[0]} ${Math.round(cv.share * 100)}%`).join(", ") || "—"}
        </span>
      ),
    },
  ];

  const testerCols: Column<CalibrationCell>[] = [
    { head: "pages", render: (c) => <span className="tabular-nums text-text-secondary">{c.n}</span> },
    { head: "issues / pg", render: (c) => <span className="font-medium tabular-nums text-text-primary">{c.value ?? "—"}</span> },
    {
      head: "vs mean",
      render: (c) => (
        <span className="tabular-nums text-text-secondary">{c.divergence === null ? "—" : `${c.divergence}×`}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Developers</h2>
          <Link href={href({ view: "people", raw: showRaw ? null : "1" })}
            className="text-[13px] font-medium text-accent hover:underline">
            {showRaw ? "Show tester-adjusted" : "Show raw, unadjusted"}
          </Link>
        </div>
        <p className="mb-3 text-[13px] text-text-secondary">
          Issues per page is a joint product of how much the developer got wrong and how hard
          their reviewer looked. The adjusted column divides the reviewer back out; the raw
          column and the reviewer mix are both shown so the adjustment is auditable.
          {usable < 3 && (
            <span className="text-warning-strong">
              {" "}Only {usable} reviewer{usable === 1 ? "" : "s"} has enough pages to adjust against — treat the ordering as indicative.
            </span>
          )}
        </p>
        <CellTable cells={adjusted} label={name} columns={devCols} />
        {adjusted[0]?.note && (
          <p className="mt-2 text-[12px] text-text-muted">{adjusted[0].note}</p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Testers — calibration</h2>
        <p className="mb-3 text-[13px] text-text-secondary">
          Not performance. A reviewer who finds more than the mean is differently tuned, not
          better or worse — and that difference is exactly what the developer column above
          corrects for.
        </p>
        <CellTable cells={testers} label={name} columns={testerCols} />
      </section>

      <BlockedList
        title="Not measurable per person"
        items={[{
          metric: "Issues done, and anything derived from it",
          because: "Issue.status records which import a row came from, not whether anyone fixed it. Every issue delivered Jan–Jun is FIXED, written in one batch and never touched since; everything from July on is OPEN.",
          unblockedBy: "issues actually being resolved in the product",
        }]}
      />
    </div>
  );
}

// ─── delivery ───────────────────────────────────────────────────────────────

function DeliveryView({
  rows, period,
}: {
  rows: { deliveryMonth: string | null; delayDays: number }[];
  period: ReturnType<typeof makePeriod>;
}) {
  const scoped = rows.filter((r) => r.deliveryMonth && period.months.includes(r.deliveryMonth));
  const late = scoped.filter((r) => r.delayDays > 0);
  const onTime = scoped.length ? Math.round((100 * (scoped.length - late.length)) / scoped.length) : null;
  const totalDelay = late.reduce((n, r) => n + r.delayDays, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label="On-time delivery" value={onTime} suffix="%" />
        <Tile label="Pages delivered late" value={late.length} note={`of ${scoped.length}`} />
        <Tile label="Total delay" value={totalDelay} note="days, all pages" />
      </div>
      <section className="rounded-xl border border-border-soft bg-card-soft/50 p-5">
        <h2 className="text-sm font-semibold text-text-primary">Why this is not a headline number</h2>
        <p className="mt-1.5 text-[13px] text-text-secondary">
          On-time delivery is saturated: {late.length} of {scoped.length} pages in this scope were
          late at all, for {totalDelay} day{totalDelay === 1 ? "" : "s"} between them. A metric that
          reads 100% for almost everybody cannot separate anybody, so it lives here rather than at
          the top of the page. Cycle time would separate them — it needs a build-start and a
          QA-start timestamp, and neither is recorded.
        </p>
      </section>
    </div>
  );
}

// ─── shared ─────────────────────────────────────────────────────────────────

function Tile({
  label: text, value, decimals = 0, suffix, note, prev,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  suffix?: string;
  note?: string;
  prev?: number | null;
}) {
  return (
    <div className="rounded-xl border border-border-soft bg-card px-4 py-4 sm:px-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted sm:text-[11px]">
        {text}
      </div>
      <div className="mt-2 text-[24px] font-semibold leading-none tracking-tight tabular-nums text-text-primary sm:text-[28px]">
        {value === null ? <span className="text-text-muted">—</span> : <AnimatedNumber value={value} decimals={decimals} />}
        {value !== null && suffix}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-muted">
        {note}
        {prev !== undefined && <Delta now={value} before={prev ?? null} />}
      </div>
    </div>
  );
}
