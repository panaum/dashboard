import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { BarFigure, CellTable, scaleOf, type Column } from "@/components/insights/cell-table";
import { TSelect, TButton, TLink, Tile } from "@/components/insights/controls";
import { Trend } from "@/components/insights/trend";
import { ViewTabs, isView, type ViewKey } from "@/components/insights/view-tabs";
import { buildPageWhere, hasAnyFilter } from "@/lib/page-search";
import { listPlatforms } from "@/lib/platforms";
import { rollingMonths, ROLLING_MONTHS } from "@/lib/team-performance";
import {
  byClient, byPlatform, defectRate, defectRateBy, defectRateByMonth, inPeriod, makePeriod,
  monthSeriesBy,
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
        <PeopleView {...{ pages, period, showRaw, href }} nameOf={nameOf} />
      ) : (
        <DeliveryView rows={rows} period={period} />
      )}
    </div>
    </div>
  );
}

// ─── process ────────────────────────────────────────────────────────────────


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
  const platformSeries = monthSeriesBy(pages, period, byPlatform);
  const thin = platforms.filter((c) => c.confidence !== "high").length;
  const months = defectRateByMonth(pages, period);

  return (
    <div className={SECTIONS}>
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
        <CellTable
          cells={platforms}
          label={(k) => label(k)}
          unit="issues / pg"
          mean={rate.value}
          series={platformSeries}
        />
      </section>

      {months.length > 1 && <Trend months={months} mean={rate.value} />}

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

  // THE ABSOLUTE COUNT, NOT A SPARKLINE.
  //
  // Most clients deliver in one or two months of the period, so the trend
  // column was a field of isolated dots — shape where there was no shape.
  // Total issues is the half of the story a rate hides: Option Goddess runs
  // 13.17 per page and produces 79 issues, while Trading Cafe runs 7.21 and
  // produces 281. The rate says who is worst per page; this says where the
  // work actually goes.
  const issuesByClient = new Map<string, number>();
  for (const pg of inPeriod(pages, period)) {
    issuesByClient.set(pg.clientId, (issuesByClient.get(pg.clientId) ?? 0) + pg.issues.length);
  }
  const clientCols: Column[] = [
    { head: "pages", width: "4.5rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.n}</span> },
    {
      head: "issues",
      width: "5rem",
      render: (c) => <span className="fig text-[var(--ink-2)]">{issuesByClient.get(c.key) ?? 0}</span>,
    },
    {
      head: "issues / pg",
      width: "8rem",
      render: (c, i) => <BarFigure value={c.value} mean={mean ?? null} max={scaleOf(cells)} delay={i * 40} />,
    },
  ];
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
        <CellTable cells={cells} label={(k) => nameOf.get(k) ?? k} columns={clientCols} />
      </section>

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

  // ONE NUMBER PER PERSON.
  //
  // This table used to carry PAGES / RAW / ADJUSTED / REVIEWED BY, and on any
  // filtered view — where nobody has enough pages to adjust against — the
  // ADJUSTED column was an em-dash for every row beside a RAW column holding
  // the real figure. Four columns to say one thing, and the one that looked
  // like the answer was empty.
  //
  // Now there is a single "issues / page". It shows the adjusted rate when the
  // reviewers can carry one and the raw rate when they cannot, marked so you
  // always know which you are reading, with the other number on hover.
  const devCols: Column<AdjustedCell>[] = [
    { head: "pages", width: "4.5rem", render: (c) => <span className="fig text-[var(--ink-2)]">{c.n}</span> },
    {
      head: "issues / page",
      width: "8rem",
      render: (c) => {
        const adjusted = !showRaw && c.value !== null;
        const shown = adjusted ? c.value : c.raw;
        return (
          <span
            title={
              adjusted
                ? `Raw rate ${c.raw} — adjusted to ${c.value} for who reviewed these pages`
                : "Raw rate: not enough reviewer data to adjust it"
            }
            className="inline-flex items-baseline justify-end gap-1.5"
          >
            {/* Plain ink, deliberately. The platform and client tables band
                their figures green-to-red, and that is right there: a platform
                is not a person. Painting three developers red in a column is
                socially expensive in a way the number itself is not, and the
                ordering already says everything the colour would. */}
            <span className="fig font-medium text-[var(--ink)]">{shown ?? "—"}</span>
            {!adjusted && <span className="t-micro text-[10px] text-[var(--ink-3)]">raw</span>}
          </span>
        );
      },
    },
    {
      head: "reviewed by",
      // Wider, and indented away from the figure column: the names used to
      // start the moment the issues/page number ended, so a right-aligned
      // decimal and a left-aligned name collided in the middle of the row.
      width: "14rem",
      align: "left",
      render: (c) => (
        <span className="t-body block truncate pl-6 text-[var(--ink-2)]">
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
            {showRaw ? "show reviewer-adjusted" : "show raw, uncorrected"}
          </Link>
        </div>
        <p className="t-body max-w-[72ch] text-[var(--ink-2)]">
          Issues found per page built. Some reviewers look harder than others, so where the
          numbers allow it this is corrected for who reviewed the work — hover any figure to
          see the raw rate and what it was adjusted to.
          {usable < 3 && (
            <span className="text-[var(--watch)]">
              {" "}
              {usable === 0
                ? "No reviewer here has enough pages to correct against, so these are raw rates."
                : `Only ${usable} reviewer${usable === 1 ? " has" : "s have"} enough pages to correct against — treat the order as indicative.`}
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

    </div>
  );
}
