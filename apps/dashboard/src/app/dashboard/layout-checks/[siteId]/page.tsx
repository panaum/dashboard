import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckRunner } from "@/components/layout-checks/check-runner";
import { diffRuns, verdictOf } from "@/lib/linkspy/layout-history";
import {
  type ResponsiveFinding,
  FINDING_TONE,
  orderFindings,
  widthLabel,
} from "@/lib/linkspy/responsive-view";

export const metadata = { title: "Layout history" };

const MOVE_LABEL = {
  fixed: "Fixed", introduced: "New", "still-open": "Still open", unchanged: "Unchanged",
} as const;
const MOVE_TONE = {
  fixed: "success", introduced: "error", "still-open": "warning", unchanged: "neutral",
} as const;

export default async function LayoutSitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  await requireAuth();
  const { siteId } = await params;

  const site = await db.layoutSite.findUnique({
    where: { id: siteId },
    include: {
      runs: {
        orderBy: { checkedAt: "desc" },
        take: 12,
        include: { shots: { select: { width: true }, orderBy: { width: "asc" } } },
      },
    },
  });
  if (!site) notFound();

  const [current, previous] = site.runs;
  const changes = current
    ? diffRuns(
        previous
          ? { checkedAt: previous.checkedAt.toISOString(),
              findings: previous.findings as unknown as ResponsiveFinding[] }
          : null,
        { checkedAt: current.checkedAt.toISOString(),
          findings: current.findings as unknown as ResponsiveFinding[] },
      )
    : [];
  const verdict = verdictOf(changes, Boolean(previous));
  const findings = current
    ? orderFindings(current.findings as unknown as ResponsiveFinding[])
    : [];

  return (
    <>
      <Link href="/dashboard/layout-checks"
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> All layout checks
      </Link>

      <PageHeader
        title={site.label ?? site.url.replace(/^https?:\/\//, "")}
        subtitle={site.url}
        action={<CheckRunner url={site.url} label={current ? "Re-test" : "Run first check"} />}
      />

      {!current ? (
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-text-secondary">
            No checks yet. Run one to record how this page renders at eight widths.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="px-5 py-4">
            <p className="text-sm font-medium text-text-primary">{verdict.headline}</p>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Checked {current.checkedAt.toLocaleString()}
              {previous && ` · compared against ${previous.checkedAt.toLocaleString()}`}
            </p>
          </Card>

          {previous && (
            <Card>
              <CardHeader>
                <CardTitle>What changed since the last check</CardTitle>
              </CardHeader>
              <div className="flex flex-col divide-y divide-border-soft">
                {changes.filter((c) => c.movement !== "unchanged").length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-text-secondary">
                    Nothing moved between these two checks.
                  </p>
                ) : (
                  changes
                    .filter((c) => c.movement !== "unchanged")
                    .map((c) => (
                      <div key={c.id} className="flex flex-wrap items-baseline gap-2 px-5 py-3">
                        <Badge tone={MOVE_TONE[c.movement]}>{MOVE_LABEL[c.movement]}</Badge>
                        <span className="text-sm font-medium text-text-primary">{c.title}</span>
                        <span className="text-[12px] text-text-muted">
                          {c.before ?? "—"} → {c.after ?? "—"}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>This check</CardTitle>
            </CardHeader>
            <div className="flex flex-col divide-y divide-border-soft">
              {findings.map((f) => (
                <div key={f.id} className="px-5 py-3">
                  <div className="mb-0.5 flex items-center gap-2">
                    <Badge tone={FINDING_TONE[f.status]}>{f.status}</Badge>
                    <span className="text-sm font-medium text-text-primary">{f.title}</span>
                  </div>
                  {f.detail && (
                    <p className="max-w-prose text-[13px] text-text-secondary">{f.detail}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {current.shots.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  How it renders{previous?.shots.length ? " — now, and last time" : ""}
                </CardTitle>
              </CardHeader>
              <div className="grid grid-cols-2 gap-4 px-5 pb-5 sm:grid-cols-4">
                {current.shots.map((s) => {
                  const had = previous?.shots.some((p) => p.width === s.width);
                  return (
                    <div key={s.width} className="flex flex-col gap-1.5">
                      <span className="text-[12px] text-text-secondary">{widthLabel(s.width)}</span>
                      <a href={`/api/layout-shot?runId=${current.id}&width=${s.width}`}
                         target="_blank" rel="noopener"
                         className="block overflow-hidden rounded-lg border border-border-soft transition-colors hover:border-accent/50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/layout-shot?runId=${current.id}&width=${s.width}`}
                             alt={`Rendered at ${s.width} pixels wide`} loading="lazy"
                             className="block h-36 w-full object-cover object-top" />
                      </a>
                      {had && previous && (
                        <a href={`/api/layout-shot?runId=${previous.id}&width=${s.width}`}
                           target="_blank" rel="noopener"
                           className="text-[11px] text-accent hover:underline">
                          compare with last check
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="px-5 pb-5 text-[12px] text-text-muted">
                Screenshots are kept for the two most recent checks. Older checks keep
                what they found, but not the images.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <div className="flex flex-col divide-y divide-border-soft">
              {site.runs.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="w-52 text-[13px] text-text-secondary">
                    {r.checkedAt.toLocaleString()}
                  </span>
                  <Badge tone={r.worst === "FAIL" ? "error" : r.worst === "WARN" ? "warning"
                    : r.worst === "SKIP" ? "neutral" : "success"}>
                    {r.worst}
                  </Badge>
                  <span className="text-[12px] text-text-muted">
                    {r.failCount} failing · {r.warnCount} to look at
                  </span>
                  {r.shots.length === 0 && (
                    <span className="ml-auto text-[11px] text-text-muted">images pruned</span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <a href={site.url} target="_blank" rel="noopener"
             className="inline-flex w-fit items-center gap-2 text-[13px] text-text-secondary hover:text-text-primary">
            Open the page <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </>
  );
}
