import { PageHeader } from "@/components/shared/page-header";
import { UrlChecker } from "@/components/linkspy/url-checker";
import { MonitorGrid } from "@/components/linkspy/monitor-grid";
import { SitesStatRail } from "@/components/linkspy/sites-stat-rail";
import { WatchdogPanel } from "@/components/linkspy/watchdog-panel";
import { monitorSummary } from "@/lib/linkspy/monitor-metrics";
import {
  fetchMonitorDashboard,
  fetchMonitorFragility,
  fetchMonitorWatchdog,
} from "@/lib/linkspy/sites-data";
import type { DashboardSite } from "@/lib/linkspy/monitor-metrics";

export const metadata = { title: "Sites" };
export const dynamic = "force-dynamic";

// PAGE 1 (monitoring spec §2) — every monitored LinkSpy site, not just the
// registry-annotated subset. Initial data is server-rendered; the grid then
// owns refetching through the session-guarded proxies.

export default async function SitesPage() {
  const [dashboard, fragility, watchdog] = await Promise.all([
    fetchMonitorDashboard(),
    fetchMonitorFragility(),
    fetchMonitorWatchdog(),
  ]);

  const sites: DashboardSite[] = dashboard?.sites ?? [];
  // A missing band never blocks a card (spec §2): skip insufficient rows.
  const bands: Record<string, string> = {};
  for (const row of fragility?.sites ?? []) {
    if (row.site_id && row.band && !row.insufficient) bands[row.site_id] = row.band;
  }

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Every monitored property, live from LinkSpy — inside the dashboard."
      />

      {sites.length > 0 && <SitesStatRail summary={monitorSummary(sites, Date.now())} />}

      <UrlChecker />

      <MonitorGrid initialSites={sites} bands={bands} unavailable={dashboard === null} />

      <WatchdogPanel data={watchdog?.hosts ? { ...watchdog, hosts: watchdog.hosts } : null} />
    </div>
  );
}
