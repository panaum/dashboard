import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { SiteTabs } from "@/components/linkspy/site-tabs";
import { ResponsivePanel } from "@/components/linkspy/responsive-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listRegistrySites,
  fetchSitePresence,
  fetchSiteIncidents,
  fetchSiteVitals,
  fetchSiteHistory,
  fetchIntentMap,
  fetchConsent,
  linkspySiteHref,
} from "@/lib/linkspy/sites-data";
import { PromiseMap } from "@/components/linkspy/promise-map";
import { ConsentPanel } from "@/components/linkspy/consent-panel";
import {
  buildIncidentsView,
  buildVitalsView,
  buildHistoryView,
  collapseHistory,
  linkRange,
  healthTone,
  ESCALATION_TONE,
} from "@/lib/linkspy/sites-view";
import { hostOf } from "@/lib/linkspy/link-match";

export const metadata = { title: "Site" };
export const dynamic = "force-dynamic";

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ u?: string }>;
}) {
  const { siteId } = await params;
  const { u } = await searchParams;
  // The registry knows only client-annotated sites; the monitoring grid links
  // every site here, passing ?u= so un-annotated ones still get a real header.
  const sites = await listRegistrySites();
  const site = sites?.find((s) => s.id === siteId);

  const [presence, incidentsPayload, vitalsPayload, historyPayload,
         intentPayload, consentPayload] =
    await Promise.all([
      fetchSitePresence(siteId),
      fetchSiteIncidents(siteId),
      fetchSiteVitals(siteId),
      fetchSiteHistory(siteId),
      fetchIntentMap(siteId),
      fetchConsent(siteId),
    ]);
  const incidents = buildIncidentsView(incidentsPayload);
  const vitals = buildVitalsView(vitalsPayload);
  const history = buildHistoryView(historyPayload);
  const openHref = linkspySiteHref(presence?.site_path ?? `/dashboard/${siteId}`);
  const host = hostOf(site?.url) ?? hostOf(u ?? null) ?? siteId;

  return (
    <div>
      <Link
        href="/dashboard/sites"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> All sites
      </Link>

      <PageHeader
        title={host}
        subtitle={site ? `${site.clientName} · monitored by LinkSpy` : "Monitored by LinkSpy"}
        action={
          openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-border-soft bg-card px-3.5 py-2 text-sm font-medium text-text-secondary shadow-xs transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              Open in LinkSpy <ExternalLink className="size-3.5" strokeWidth={1.5} />
            </a>
          ) : undefined
        }
      />

      <SiteTabs
        layout={<ResponsivePanel url={site?.url ?? u ?? null} />}
        overview={
          <>
        {/* Vitals — LinkSpy's own guard cards (SSL / domain / indexability /
            uptime), most urgent first, exactly as its site view sorts them. */}
        {vitals.state === "cards" && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {vitals.cards.map((c) => (
              <Card key={c.key} className="px-4 py-3.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    {c.label}
                  </span>
                  <Badge tone={ESCALATION_TONE[c.escalation] ?? "neutral"}>
                    {c.escalation === "ok" ? "ok" : c.escalation}
                  </Badge>
                </div>
                <p className="text-lg font-semibold text-text-primary">{c.fact}</p>
                {c.detail && (
                  <p className="truncate text-[12px] text-text-muted" title={c.detail}>
                    {c.detail}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Needs attention — live problems only; empty when nothing is wrong. */}
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            {!presence ? (
              <p className="text-[13px] text-text-secondary">
                LinkSpy did not answer — this check is unavailable right now.
              </p>
            ) : presence.signals.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} />
                Nothing needs attention
                {presence.last_checked && ` · last checked ${presence.last_checked.slice(0, 10)}`}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {presence.signals.map((sig) => (
                  <li key={sig.key} className="flex items-center gap-2.5 text-sm text-text-primary">
                    <Badge tone={sig.severity === "critical" ? "error" : "warning"}>
                      {sig.severity === "critical" ? "Critical" : "Warning"}
                    </Badge>
                    <span>{sig.text}</span>
                    {sig.qualifier && (
                      <span className="text-[13px] text-text-muted">{sig.qualifier}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {presence && presence.open_incidents > 0 && (
          <p className="flex items-center gap-2 text-[13px] text-text-secondary">
            <AlertTriangle className="size-4 text-warning" strokeWidth={1.75} />
            {presence.open_incidents} open incident{presence.open_incidents === 1 ? "" : "s"} in
            LinkSpy — the “Open in LinkSpy” button above lands on the site’s timeline.
          </p>
        )}
          </>
        }
        promises={
          <>
            {/* Conversion promises and whether the destinations honor them. */}
            <PromiseMap payload={intentPayload} />
          </>
        }
        privacy={
          <>
            {/* Cookie / tracking observation ledger. */}
            <ConsentPanel payload={consentPayload} />
          </>
        }
        history={
          <>
        {/* Scan history. Runs of unchanged scans collapse into one line —
            thirty rows reading "99 health · 1 finding" tell the reader one
            fact, not thirty, and hide the scan where something moved. */}
        {history.state === "series" && (
          <Card>
            <CardHeader>
              <CardTitle>Scan history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5">
                {collapseHistory(history.points).map((run, i) => (
                  <li key={`${run.to}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
                    <Badge tone={healthTone(run.health)}>
                      {typeof run.health === "number" ? `${run.health} health` : "no score"}
                    </Badge>
                    <span className="text-text-secondary">
                      {linkRange(run)} links · {run.findings ?? 0} finding{(run.findings ?? 0) === 1 ? "" : "s"}
                      {(run.recurring ?? 0) > 0 && `, ${run.recurring} recurring`}
                    </span>
                    {run.changed && (
                      <>
                        {run.changed.new > 0 && <Badge tone="error">+{run.changed.new} new</Badge>}
                        {run.changed.fixed > 0 && <Badge tone="success">−{run.changed.fixed} fixed</Badge>}
                      </>
                    )}
                    <span className="ml-auto text-[12px] text-text-muted">
                      {run.scans > 1
                        ? `${run.scans} scans · ${run.from.slice(0, 10)} → ${run.to.slice(0, 10)}`
                        : run.to.slice(0, 10)}
                      {run.scans > 1 && !run.changed && " · unchanged"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Downtime history — stored sentinel windows, newest first. */}
        <Card>
          <CardHeader>
            <CardTitle>Downtime incidents</CardTitle>
          </CardHeader>
          <CardContent>
            {incidents.state === "unavailable" && (
              <p className="text-[13px] text-text-secondary">
                LinkSpy did not answer — incident history is unavailable right now.
              </p>
            )}
            {incidents.state === "none" && (
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} />
                No downtime recorded
              </p>
            )}
            {incidents.state === "list" && (
              <ul className="flex flex-col gap-2">
                {incidents.items.map((inc) => (
                  <li key={inc.downAt} className="flex items-center gap-2.5 text-[13px]">
                    {inc.ongoing ? (
                      <Badge tone="error">Ongoing</Badge>
                    ) : (
                      <Badge tone="neutral">Restored</Badge>
                    )}
                    <span className="text-text-primary">
                      Down {inc.downAt.slice(0, 16).replace("T", " ")}
                    </span>
                    {inc.duration && (
                      <span className="text-text-muted">· {inc.duration}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
          </>
        }
      />
    </div>
  );
}
