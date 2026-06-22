import { TrendingUp, TrendingDown, Award, AlertTriangle, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { Bar } from "@/components/reports/bar";
import { label, monthLabel } from "@/lib/constants";
import { computeInsights } from "@/lib/insights";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const pages = await db.page.findMany({
    select: {
      delayDays: true,
      deliveryMonth: true,
      developer: { select: { id: true, name: true } },
      project: { select: { platform: true } },
      issues: { select: { severity: true } },
    },
  });

  const {
    total,
    avgIssues,
    repetitive,
    onTimePct,
    platforms,
    maxPlatAvg,
    devs,
    months,
    maxMonthAvg,
  } = computeInsights(pages);

  // Auto-flagged callouts (plain-language intelligence)
  const callouts: { icon: typeof Award; tone: string; text: string }[] = [];
  if (platforms.length >= 2) {
    const cleanest = platforms[platforms.length - 1];
    const noisiest = platforms[0];
    callouts.push({
      icon: Award,
      tone: "text-success",
      text: `${label(cleanest.platform)} is your cleanest platform — ${cleanest.avg.toFixed(1)} issues per page.`,
    });
    callouts.push({
      icon: AlertTriangle,
      tone: "text-warning",
      text: `${label(noisiest.platform)} pages average ${noisiest.avg.toFixed(1)} issues — the highest of any platform.`,
    });
  }
  if (devs.length >= 1) {
    const best = devs[0];
    callouts.push({
      icon: Award,
      tone: "text-success",
      text: `${best.name} has the lowest defect rate — ${best.avg.toFixed(1)} issues per page across ${best.built} builds.`,
    });
  }
  if (months.length >= 2) {
    const first = months[0].avg;
    const last = months[months.length - 1].avg;
    const improving = last < first;
    callouts.push({
      icon: improving ? TrendingDown : TrendingUp,
      tone: improving ? "text-success" : "text-error",
      text: improving
        ? `Quality is improving — issues per page fell from ${first.toFixed(1)} to ${last.toFixed(1)} since ${monthLabel(months[0].m)}.`
        : `Issues per page rose from ${first.toFixed(1)} to ${last.toFixed(1)} since ${monthLabel(months[0].m)} — worth a look.`,
    });
  }

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Automatic read on quality and delivery across the team."
      />

      {/* Auto-flagged intelligence */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {callouts.map((c, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-xl border border-border-soft bg-card p-4"
          >
            <span className={`mt-0.5 ${c.tone}`}>
              <c.icon className="size-5" />
            </span>
            <p className="text-sm text-text-primary">{c.text}</p>
          </div>
        ))}
      </div>

      {/* Headline numbers */}
      <div className="mb-9 grid grid-cols-2 divide-x divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card md:grid-cols-4">
        {[
          { label: "Pages", value: `${total}` },
          { label: "Avg issues / page", value: avgIssues.toFixed(1) },
          { label: "On-time delivery", value: `${onTimePct}%` },
          { label: "Repetitive bugs", value: `${repetitive}` },
        ].map((s) => (
          <div key={s.label} className="px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {s.label}
            </div>
            <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Platform quality */}
        <div className="rounded-xl border border-border-soft bg-card p-5">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">
            Quality by platform
          </h2>
          <p className="mb-4 text-[13px] text-text-secondary">
            Average issues per page — lower is better.
          </p>
          <div className="flex flex-col gap-3">
            {platforms.map((p, i) => (
              <div key={p.platform} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[13px] text-text-secondary">
                  {label(p.platform)}
                </span>
                <Bar
                  pct={(p.avg / maxPlatAvg) * 100}
                  colorClass={i === platforms.length - 1 ? "bg-success" : "bg-accent"}
                  delay={i * 0.05}
                />
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                  {p.avg.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly quality trend */}
        <div className="rounded-xl border border-border-soft bg-card p-5">
          <h2 className="mb-1 text-sm font-semibold text-text-primary">
            Quality trend
          </h2>
          <p className="mb-4 text-[13px] text-text-secondary">
            Average issues per page, by delivery month.
          </p>
          <div className="flex items-end gap-3" style={{ height: 130 }}>
            {months.map((m) => {
              const h = Math.max(6, Math.round((m.avg / maxMonthAvg) * 96));
              return (
                <div
                  key={m.m}
                  className="flex flex-1 flex-col items-center justify-end gap-1.5"
                  title={`${m.avg.toFixed(1)} issues/page`}
                >
                  <span className="text-[11px] font-semibold tabular-nums text-text-primary">
                    {m.avg.toFixed(1)}
                  </span>
                  <div
                    className="w-full max-w-[40px] rounded-t-md bg-accent"
                    style={{ height: h }}
                  />
                  <span className="text-[11px] text-text-muted">
                    {monthLabel(m.m).slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Developer quality leaderboard */}
      <div className="mt-6 rounded-xl border border-border-soft bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-text-primary">
          Developer quality
        </h2>
        <p className="mb-4 text-[13px] text-text-secondary">
          Ranked by lowest issues per build (min. 3 builds).
        </p>
        <div className="flex flex-col gap-1">
          {devs.map((d, i) => (
            <div
              key={d.name}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-card-soft"
            >
              <span className="w-5 shrink-0 text-center text-[13px] font-semibold tabular-nums text-text-muted">
                {i + 1}
              </span>
              <Avatar name={d.name} size="sm" />
              <span className="flex-1 truncate text-sm font-medium text-text-primary">
                {d.name}
              </span>
              <span className="shrink-0 text-[13px] text-text-secondary">
                {d.built} builds
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                {d.avg.toFixed(1)}
                <span className="ml-1 text-[11px] font-normal text-text-muted">
                  /page
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
