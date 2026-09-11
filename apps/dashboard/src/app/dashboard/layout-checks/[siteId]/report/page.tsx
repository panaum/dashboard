import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { DpReport } from "@/lib/devicepreview/history";
import { EvidenceCrop } from "@/components/layout-checks/evidence-crop";
import { explain } from "@/lib/layout-checks/explain";
import { CHECKS } from "@/lib/layout-checks/matrix";
import {
  groupScope, reportCoverage, reportGroups, reportItems, reportVerdict, splitGroups,
  type ReportDevice, type ReportGroup,
} from "@/lib/layout-checks/report";

export const metadata = { title: "Layout check report" };

// THE REPORT — the run, written for whoever owns the site rather than whoever
// runs the tests. The Devices tab is organised by device because that is how
// you debug; this is organised by fault, because that is how you decide what
// to do. Same run, same numbers, no new measurements: everything here is
// derived from the report the service already returned.

const TONE = {
  error: { text: "text-error-strong", Icon: XCircle },
  warning: { text: "text-warning-strong", Icon: AlertTriangle },
  success: { text: "text-success-strong", Icon: CheckCircle2 },
  neutral: { text: "text-text-secondary", Icon: MinusCircle },
} as const;

// What each column of the matrix means, in the client's terms.
const CHECK_MEANS: Record<string, string> = {
  shift: "does content move after it appears",
  tap: "are links and buttons big enough, and far enough apart, for a fingertip",
  text: "is anything too small to read on a phone",
  images: "are photos served at a size that is sharp without being heavy",
  overflow: "does anything spill past the edge or make the page scroll sideways",
  fonts: "did the page's fonts actually load and draw",
};

// One kind of fault: what a visitor experiences, why it matters, what to do —
// and then, for whoever does the work, the measurements underneath.
const EVIDENCE_SHOWN = 3;

function Group({ group, runId, viewportOf }: { group: ReportGroup; runId: string; viewportOf: (profileId: string) => number }) {
  const help = explain("device", group.rule);
  const extra = group.examples.length - EVIDENCE_SHOWN;
  return (
    <div className="flex flex-col gap-4 border-t border-border-soft py-6 first:border-t-0 first:pt-2 @3xl:flex-row @3xl:gap-6">
      {group.sample ? (
        <EvidenceCrop
          src={`/api/devicepreview/shot?runId=${runId}&profile=${encodeURIComponent(group.sample.profileId)}`}
          box={group.sample.box}
          pageWidth={viewportOf(group.sample.profileId)}
          width={200}
          height={120}
        />
      ) : (
        <span className="grid h-[120px] w-[200px] shrink-0 place-items-center rounded-xl bg-card-soft px-3 text-center text-[11px] leading-snug text-text-secondary ring-1 ring-inset ring-border-soft">
          affects the whole page
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold",
                              group.severity === "error" ? "bg-error/12 text-error-strong" : "bg-warning/15 text-warning-strong")}>
            {group.severity === "error" ? "Blocking" : "Worth fixing"}
          </span>
          <h3 className="text-[17px] font-semibold leading-tight text-text-primary">{group.headline}</h3>
          <span className="text-[12px] text-text-secondary">{groupScope(group)}</span>
        </div>
        {help && <p className="max-w-[68ch] text-[14px] leading-relaxed text-text-secondary">{help.why}</p>}
        {help?.fix && (
          <p className="max-w-[68ch] text-[14px] leading-relaxed text-text-primary">
            <strong className="font-semibold">What to do:</strong> {help.fix}
          </p>
        )}
        <ul className="mt-1 flex flex-col gap-1">
          {group.examples.slice(0, EVIDENCE_SHOWN).map((e) => (
            <li key={e.key} className="max-w-[72ch] font-mono text-[11.5px] leading-relaxed text-text-secondary">{e.message}</li>
          ))}
          {extra > 0 && (
            <li className="text-[12px] text-text-secondary">and {extra} more like {extra === 1 ? "it" : "them"}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

export default async function LayoutReportPage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireAuth();
  const { siteId } = await params;

  const site = await db.layoutSite.findUnique({
    where: { id: siteId },
    include: { devicePreviews: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });
  if (!site) notFound();

  const run = site.devicePreviews[0];
  const report = run ? (run.report as unknown as DpReport) : null;
  const raw = (report?.devices ?? []) as unknown as (ReportDevice & { viewport?: { width: number } })[];
  const devices: ReportDevice[] = raw.map((d) => ({
    profileId: d.profileId ?? (d as unknown as { profile_id: string }).profile_id,
    label: d.label, engine: d.engine, status: d.status, findings: d.findings ?? [],
  }));
  const viewportOf = (profileId: string) =>
    raw.find((d) => ((d as unknown as { profile_id?: string }).profile_id ?? d.profileId) === profileId)?.viewport?.width ?? 412;

  const groups = reportGroups(reportItems(devices));
  const { blocking, next } = splitGroups(groups);
  const cov = reportCoverage(devices);
  const verdict = reportVerdict(cov, blocking);
  const { text, Icon } = TONE[verdict.tone];
  const title = site.label ?? site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const when = run ? run.checkedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  const engines = [...new Set(devices.map((d) => d.engine))].length;

  return (
    <div className="@container flex flex-col gap-8 pb-16">
      <Link href={`/dashboard/layout-checks/${siteId}`}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary print:hidden">
        <ArrowLeft className="size-3.5" /> Back to the check
      </Link>

      <article className="mx-auto w-full max-w-[64rem] rounded-2xl border border-border-soft bg-card px-8 py-10 shadow-xs @3xl:px-14 @3xl:py-14 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft pb-6">
          <span className="text-[15px] font-semibold text-text-primary">Apexure</span>
          <span className="text-[13px] text-text-secondary">{when ? `Layout check · ${when}` : "Layout check"}</span>
        </header>

        <div className="flex flex-col gap-2 pt-8">
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-text-primary">{title}</h1>
          <a href={site.url} target="_blank" rel="noopener" className="font-mono text-[13px] text-text-secondary hover:text-accent">{site.url}</a>
          {run && (
            <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-text-secondary">
              Rendered on {cov.total} device{cov.total === 1 ? "" : "s"} across {engines} browser engine{engines === 1 ? "" : "s"} and measured
              against {CHECKS.length} checks.
              {cov.inconclusive > 0 && ` ${cov.inconclusive} device${cov.inconclusive === 1 ? "" : "s"} could not be checked — blocked or failed to load — so nothing here speaks for ${cov.inconclusive === 1 ? "it" : "them"}.`}
            </p>
          )}
        </div>

        {!run ? (
          <p className="mt-8 text-[14px] text-text-secondary">This page has not been checked yet. Run the device check and the report will fill in.</p>
        ) : (
          <>
            <section className="mt-8 flex flex-col gap-5 rounded-2xl bg-page px-7 py-7">
              <div className="flex items-start gap-3">
                <Icon className={cn("mt-0.5 size-6 shrink-0", text)} strokeWidth={2} aria-hidden />
                <h2 className={cn("text-[24px] font-semibold leading-tight tracking-tight text-balance", text)}>{verdict.headline}</h2>
              </div>
              <div className="grid gap-3 @xl:grid-cols-3">
                {[
                  { n: cov.failing, label: `device${cov.failing === 1 ? "" : "s"} with a blocking issue`, tone: "text-error-strong" },
                  { n: cov.warnings, label: `device${cov.warnings === 1 ? "" : "s"} with warnings only`, tone: "text-warning-strong" },
                  { n: cov.clean, label: `device${cov.clean === 1 ? "" : "s"} clean`, tone: "text-success-strong" },
                ].map((s) => (
                  <div key={s.label} className="flex flex-col gap-0.5 rounded-xl bg-card px-4 py-3.5 ring-1 ring-inset ring-border-soft">
                    <span className={cn("text-[26px] font-semibold tabular-nums leading-none", s.tone)}>{s.n}</span>
                    <span className="text-[12px] text-text-secondary">{s.label}</span>
                  </div>
                ))}
              </div>
            </section>

            {blocking.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">Fix before launch</h2>
                <div className="mt-2">
                  {blocking.map((g) => <Group key={g.rule} group={g} runId={run.id} viewportOf={viewportOf} />)}
                </div>
              </section>
            )}

            {next.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                  {blocking.length > 0 ? "Worth fixing next" : "Worth fixing"}
                </h2>
                <div className="mt-2">
                  {next.map((g) => <Group key={g.rule} group={g} runId={run.id} viewportOf={viewportOf} />)}
                </div>
              </section>
            )}

            {blocking.length === 0 && next.length === 0 && (
              <p className="mt-8 text-[14px] leading-relaxed text-text-secondary">
                Nothing to fix. Every device we could check rendered this page without a fault worth reporting.
              </p>
            )}

            <section className="mt-12 border-t border-border-soft pt-8">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">What we checked</h2>
              <div className="mt-3 grid gap-x-10 gap-y-2.5 @xl:grid-cols-2">
                {CHECKS.map((c) => (
                  <p key={c.id} className="text-[13px] leading-relaxed text-text-secondary">
                    <strong className="font-semibold text-text-primary">{c.label}</strong> — {CHECK_MEANS[c.id]}
                  </p>
                ))}
              </div>
            </section>

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-6 text-[12px] text-text-secondary">
              <span className="max-w-[70ch]">Every finding above is measured on a real rendering of this page, not eyeballed. The full evidence, with screenshots per device, is in the Dashboard.</span>
              <Link href={`/dashboard/layout-checks/${siteId}`} className="font-medium text-accent print:hidden">Open the full check →</Link>
            </footer>
          </>
        )}
      </article>
    </div>
  );
}
