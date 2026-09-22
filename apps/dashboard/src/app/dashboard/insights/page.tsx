import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { CellTable, BandedFigure, type Column } from "@/components/insights/cell-table";
import { TSelect, TButton, TLink, Tile } from "@/components/insights/controls";
import { Trend } from "@/components/insights/trend";
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

  return (
    <div
      data-wide
      data-surface="terminal"
      className="-mx-8 -my-7 min-h-screen px-8 py-7"
    >
    <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="t-section">Insights</h1>
        <p className="t-body text-[var(--ink-2)]">
          Where defects concentrate, and how confident we are about each number.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2">
        {windowed && <input type="hidden" name="scope" value="window" />}
        {active !== "process" && <input type="hidden" name="view" value={active} />}
        <TSelect name="platform" defaultValue={sp.platform ?? ""} label="Platform">
          <option value="">Any platform</option>
          {platformOptions.map((p) => <option key={p} value={p}>{label(p)}</option>)}
        </TSelect>
        <TSelect name="status" defaultValue={sp.status ?? ""} label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </TSelect>
        <TSelect name="developerId" defaultValue={sp.developerId ?? ""} label="Developer">
          <option value="">Any developer</option>
          {members.filter((m) => m.role !== "TESTER" && m.role !== "MANAGER")
            .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </TSelect>
        <TSelect name="testerId" defaultValue={sp.testerId ?? ""} label="Tester">
          <option value="">Any tester</option>
          {members.filter((m) => m.role === "TESTER" || m.role === "BOTH")
            .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </TSelect>
        <TSelect name="month" defaultValue={sp.month ?? ""} label="Month">
          <option value="">Any month</option>
          {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </TSelect>
        <TButton>Apply</TButton>
        {hasAnyFilter(sp) && (
          <TLink href={href({ platform: null, status: null, developerId: null, testerId: null, month: null })}>
            Clear
          </TLink>
        )}
        {pages.length > 0 && (
          <a
            href={exportHref}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-[var(--r-chip)] border border-[var(--hairline-strong)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)] transition-colors hover:border-[var(--ink-3)]"
          >
            <Download className="size-3.5" strokeWidth={2} /> Export CSV
          </a>
        )}
      </form>

      <p className="t-body text-[var(--ink-2)]">
        {period.label} · <span className="fig">{rate.n}</span> page{rate.n === 1 ? "" : "s"}
        {!sp.month && (
          <>
            {" · "}
            <Link
              href={href(windowed ? { scope: null } : { scope: "window" })}
              className="text-[var(--focus)] underline-offset-4 hover:underline"
            >
              {windowed ? "All recorded history" : `Last ${ROLLING_MONTHS} months`}
            </Link>
          </>
        )}
      </p>

      <ViewTabs active={active} hrefFor={(v) => href({ view: v === "process" ? null : v })} />

      {rate.n === 0 ? (
        <div className="panel flex min-h-[220px] items-center justify-center px-4 text-center">
          <p className="t-body text-[var(--ink-2)]">
            No pages match these filters in this scope. Widen the platform or month filter.
          </p>
        </div>
      ) : active === "process" ? (
        <ProcessView {...{ pages, period, rate, weighted, recurrence, href }} />
      ) : active === "clients" ? (
        <ClientsView {...{ pages, period }} nameOf={clientName} mean={rate.value} />
      ) : active === "people" ? (
        <PeopleView {...{ pages, period, showRaw, href }} nameOf={nameOf} mean={rate.value} />
      ) : (
        <DeliveryView rows={rows} period={period} />
      )}
    </div>
    </div>
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

/** 48px between sections, 16px within them: whitespace as structure. */
const SECTIONS = "flex flex-col gap-12";
const WITHIN = "flex flex-col gap-4";

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
  const thin = platforms.filter((c) => c.confidence !== "high").length;
  const months = defectRateByMonth(pages, period);

  return (
    <div className={SECTIONS}>
      {/* The only surface on this page allowed visual urgency — and it is
          currently reporting that it has nothing to report, which is the
          honest state. A small filled glyph and weight, never a red banner. */}
      <section className="panel t-in flex items-start gap-3 p-4">
        <span
          aria-hidden
          className="mt-[3px] size-2 shrink-0 rounded-full bg-[var(--ink-3)]"
        />
        <div className={WITHIN}>
          <h2 className="t-card">In-flight risk — not available</h2>
          <p className="t-body text-[var(--ink-2)]">
            Pages on QA round ≥3, stuck in QA, or heading for a platform that runs hot: every one of
            these needs a QA round number or a stage timestamp, and neither is recorded anywhere.
            Until they are, this page is entirely retrospective and says so here rather than
            pretending the risk is zero.
          </p>
        </div>
      </section>

      <section className={WITHIN}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Pages" value={rate.n} note={period.label} />
          <Tile
            label="Issues / page"
            value={rate.value}
            decimals={2}
            note="team mean"
            band={null}
          />
          <Tile
            label="Weighted / page"
            value={weighted.value}
            decimals={2}
            note="severity-weighted"
          />
          <Tile
            label="Repeat defects"
            value={recurrence.value}
            decimals={1}
            unit="%"
            note={`of ${recurrence.n} issues`}
          />
        </div>
        {recurrence.value === 0 && (
          <p className="t-body flex items-center gap-2 text-[var(--good)]">
            <span aria-hidden>✓</span>
            No defect was recorded as a repeat of an earlier one this period.
          </p>
        )}
      </section>

      <section className={WITHIN}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-card">Where defects concentrate</h2>
          <span className="t-micro">by platform</span>
        </div>
        <p className="t-body text-[var(--ink-2)]">
          A platform cell carries an order of magnitude more pages than any per-person figure.
          {thin > 0 && (
            <>
              {" "}
              <span className="fig">{thin}</span> of <span className="fig">{platforms.length}</span>{" "}
              platforms sit below <span className="fig">{MIN_N}</span> pages and are withheld from the
              ranking.
            </>
          )}
        </p>
        <CellTable cells={platforms} label={(k) => label(k)} unit="issues / pg" mean={rate.value} />
      </section>

      {months.length > 1 && <Trend months={months} mean={rate.value} />}

      <BlockedList title="Not measurable with what we record" items={PROCESS_BLOCKED} />

      <p className="t-body text-[var(--ink-3)]">
        Looking for the people view? It is{" "}
        <Link href={href({ view: "people" })} className="text-[var(--focus)] underline-offset-4 hover:underline">
          one tab across
        </Link>
        , deliberately — a per-person rate has the thinnest evidence on this page.
      </p>
    </div>
  );
}

// ─── clients ────────────────────────────────────────────────────────────────

function ClientsView({
  pages, period, nameOf, mean,
}: {
  pages: PageRow[];
  period: ReturnType<typeof makePeriod>;
  nameOf: Map<string, string>;
  mean: number | null;
}) {
  const cells = defectRateBy(pages, period, byClient);
  const rankable = cells.filter((c) => c.confidence === "high");
  return (
    <div className={SECTIONS}>
      <section className={WITHIN}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-card">Defect rate by client</h2>
          <span className="t-micro">issues per page</span>
        </div>
        <p className="t-body text-[var(--ink-2)]">
          <span className="fig">{rankable.length}</span> of <span className="fig">{cells.length}</span>{" "}
          clients have <span className="fig">{MIN_N}</span> or more delivered pages. The rest are one
          or two pages each — shown, hatched, and kept out of the ordering, because two pages is not
          a trend about an account.
        </p>
        <CellTable cells={cells} label={(k) => nameOf.get(k) ?? k} unit="issues / pg" mean={mean} />
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
  pages, period, showRaw, nameOf, href, mean,
}: {
  pages: PageRow[];
  period: ReturnType<typeof makePeriod>;
  showRaw: boolean;
  nameOf: Map<string, string>;
  href: (o: Record<string, string | null>) => string;
  mean: number | null;
}) {
  const adjusted = testerAdjustedDefectRate(pages, period);
  const testers = testerCalibration(pages, period);
  const usable = testerRates(pages, period).filter((t) => t.pages >= MIN_N).length;
  const name = (k: string) => nameOf.get(k) ?? k;

  const devCols: Column<AdjustedCell>[] = [
    { head: "pages", width: "4rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.n}</span> },
    { head: "raw", width: "4.5rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.raw ?? "—"}</span> },
    {
      head: showRaw ? "raw" : "adjusted",
      width: "6.5rem",
      render: (c) => <BandedFigure value={showRaw ? c.raw : c.value} mean={mean ?? null} />,
    },
    {
      head: "reviewed by",
      width: "11rem",
      align: "left",
      render: (c) => (
        <span className="t-body truncate text-[var(--ink-2)]">
          {c.coverage
            .slice(0, 2)
            .map((cv) => `${name(cv.testerId).split(" ")[0]} ${Math.round(cv.share * 100)}%`)
            .join("  ") || "—"}
        </span>
      ),
    },
  ];

  const testerCols: Column<CalibrationCell>[] = [
    { head: "pages", width: "4rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.n}</span> },
    { head: "issues / pg", width: "6rem", render: (c) => <span className="fig text-[var(--ink)]">{c.value ?? "—"}</span> },
    {
      head: "vs mean",
      width: "5rem",
      render: (c) => (
        <span className="fig text-[var(--ink-2)]">{c.divergence === null ? "—" : `${c.divergence}×`}</span>
      ),
    },
  ];

  return (
    <div className={SECTIONS}>
      <section className={WITHIN}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-card">Developers</h2>
          <Link
            href={href({ view: "people", raw: showRaw ? null : "1" })}
            className="t-micro text-[var(--focus)] underline-offset-4 hover:underline"
          >
            {showRaw ? "show tester-adjusted" : "show raw, unadjusted"}
          </Link>
        </div>
        <p className="t-body max-w-[68ch] text-[var(--ink-2)]">
          Issues per page is a joint product of how much the developer got wrong and how hard their
          reviewer looked. The adjusted column divides the reviewer back out; the raw column and the
          reviewer mix sit in the same row so the adjustment is auditable.
          {usable < 3 && (
            <span className="text-[var(--watch)]">
              {" "}Only <span className="fig">{usable}</span> reviewer{usable === 1 ? "" : "s"} has
              enough pages to adjust against — treat the ordering as indicative.
            </span>
          )}
        </p>
        <CellTable cells={adjusted} label={name} columns={devCols} />
        {adjusted[0]?.note && <p className="t-body text-[var(--ink-3)]">{adjusted[0].note}</p>}
      </section>

      <section className={WITHIN}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-card">Testers — calibration</h2>
          <span className="t-micro">not performance</span>
        </div>
        <p className="t-body max-w-[68ch] text-[var(--ink-2)]">
          A reviewer who finds more than the mean is differently tuned, not better or worse — and that
          difference is exactly what the developer column above corrects for.
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
    <div className={SECTIONS}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tile label="On-time delivery" value={onTime} unit="%" note="of pages delivered" />
        <Tile label="Delivered late" value={late.length} note={`of ${scoped.length} pages`} />
        <Tile label="Total delay" value={totalDelay} note="days, every page combined" />
      </div>

      <section className="panel t-in bg-[var(--surface-sunken)] p-5">
        <h2 className="t-card">Why this is not a headline number</h2>
        <p className="t-body mt-1.5 max-w-[68ch] text-[var(--ink-2)]">
          On-time delivery is saturated. <span className="fig">{late.length}</span> of{" "}
          <span className="fig">{scoped.length}</span> pages in this scope were late at all, by{" "}
          <span className="fig">{totalDelay}</span> day{totalDelay === 1 ? "" : "s"} between them. A
          metric that reads <span className="fig">100%</span> for almost everybody cannot separate
          anybody, so it lives here rather than at the top of the page. Cycle time would separate
          them — it needs a build-start and a QA-start timestamp, and neither is recorded.
        </p>
      </section>
    </div>
  );
}
