import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileSearch, Globe } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listRegistrySites,
  fetchSitePresence,
  fetchSiteScan,
  fetchSiteIncidents,
  fetchSiteVitals,
  fetchSiteHistory,
  pagesForSite,
  linkspySiteHref,
} from "@/lib/linkspy/sites-data";
import {
  buildScanView,
  buildIncidentsView,
  buildVitalsView,
  buildHistoryView,
  bucketTone,
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

  const [presence, scanPayload, incidentsPayload, vitalsPayload, historyPayload, pages] =
    await Promise.all([
      fetchSitePresence(siteId),
      fetchSiteScan(siteId),
      fetchSiteIncidents(siteId),
      fetchSiteVitals(siteId),
      fetchSiteHistory(siteId),
      pagesForSite(siteId),
    ]);
  const scan = buildScanView(scanPayload);
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

      <div className="flex flex-col gap-4">
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

        {/* Production signals — same wire read as the checklist strip. */}
        <Card>
          <CardHeader>
            <CardTitle>Production signals</CardTitle>
          </CardHeader>
          <CardContent>
            {!presence ? (
              <p className="text-[13px] text-text-secondary">
                LinkSpy did not answer — signals are unavailable right now.
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

        {/* Latest scan — stored results only; nothing here triggers a scan. */}
        <Card>
          <CardHeader>
            <CardTitle>Latest link scan</CardTitle>
          </CardHeader>
          <CardContent>
            {scan.state === "unavailable" && (
              <p className="text-[13px] text-text-secondary">
                LinkSpy did not answer — the latest scan is unavailable right now.
              </p>
            )}
            {scan.state === "no_scan" && (
              <p className="flex items-center gap-2 text-[13px] text-text-secondary">
                <FileSearch className="size-4" strokeWidth={1.75} />
                No scan stored yet — run one from LinkSpy to see results here.
              </p>
            )}
            {(scan.state === "clean" || scan.state === "issues") && (
              <>
                <p className="mb-3 text-[13px] text-text-secondary">
                  {scan.totals.links} links checked · {scan.totals.ok} ok ·{" "}
                  {scan.totals.broken} broken · {scan.totals.dead_cta} dead CTAs ·{" "}
                  {scan.totals.unverifiable} unverifiable
                  {scan.scannedAt && ` · scanned ${scan.scannedAt.slice(0, 10)}`}
                </p>
                {scan.state === "clean" ? (
                  <p className="flex items-center gap-2 text-sm text-text-primary">
                    <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} />
                    All links passed
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-text-muted">
                          <th className="py-2 pr-4 font-semibold">Link</th>
                          <th className="py-2 pr-4 font-semibold">State</th>
                          <th className="py-2 font-semibold">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scan.flagged.map((f, i) => (
                          <tr key={`${f.url}-${i}`} className="border-b border-border-soft/60">
                            <td className="max-w-90 truncate py-2 pr-4 text-text-primary" title={f.url}>
                              {f.url}
                            </td>
                            <td className="py-2 pr-4">
                              <Badge tone={bucketTone(f.bucket)}>
                                {f.bucket === "dead_cta" ? "dead CTA" : (f.bucket ?? "flagged")}
                              </Badge>
                            </td>
                            <td className="py-2 text-text-secondary">
                              {f.reason ?? f.label ?? (f.status_code ? `HTTP ${f.status_code}` : "—")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Scan history — per-scan trend from stored snapshots, newest first. */}
        {history.state === "series" && (
          <Card>
            <CardHeader>
              <CardTitle>Scan history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {history.points.map((p) => (
                  <li key={p.at} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-24 shrink-0 text-text-muted">{p.at?.slice(0, 10)}</span>
                    <Badge tone={healthTone(p.health_score)}>
                      {typeof p.health_score === "number" ? `${p.health_score} health` : "no score"}
                    </Badge>
                    <span className="text-text-secondary">
                      {p.total_links ?? "—"} links · {p.findings ?? 0} finding{(p.findings ?? 0) === 1 ? "" : "s"}
                    </span>
                    {(p.new ?? 0) > 0 && <Badge tone="error">+{p.new} new</Badge>}
                    {(p.fixed ?? 0) > 0 && <Badge tone="success">−{p.fixed} fixed</Badge>}
                    {(p.recurring ?? 0) > 0 && <Badge tone="warning">{p.recurring} recurring</Badge>}
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

        {/* The other half of the bridge: which QA pages point here. */}
        <Card>
          <CardHeader>
            <CardTitle>Linked QA pages</CardTitle>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <p className="text-[13px] text-text-secondary">
                No dashboard pages link to this site yet — use “Link to LinkSpy” on a page detail.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {pages.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/dashboard/clients/${p.project.clientId}/${p.project.id}/${p.id}`}
                      className="inline-flex items-center gap-2 text-sm font-medium text-text-primary transition-colors hover:text-accent"
                    >
                      <Globe className="size-3.5 text-text-muted" strokeWidth={1.5} />
                      {p.project.client.name} › {p.name}
                    </Link>
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
      </div>
    </div>
  );
}
