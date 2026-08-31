import Link from "next/link";
import { ChevronRight, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listRegistrySites, linkedPageCounts, fetchSiteChips } from "@/lib/linkspy/sites-data";
import { buildSitesList, summarizeSitesHealth } from "@/lib/linkspy/sites-view";

// SITES HEALTH — one quiet line on the Overview. Self-contained on purpose:
// it fetches its own data and renders NOTHING when LinkSpy is unreachable or
// no sites are visible, so the Overview never waits on, or breaks for, the
// other system.
export async function SitesHealthStrip() {
  const sites = await listRegistrySites().catch(() => null);
  if (!sites || sites.length === 0) return null;

  const ids = sites.map((s) => s.id);
  const [chips, linked] = await Promise.all([fetchSiteChips(ids), linkedPageCounts(ids)]);
  const health = summarizeSitesHealth(buildSitesList(sites, chips, linked));

  return (
    <Link href="/dashboard/sites" className="group mb-9 block">
      <div className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-5 py-3.5 shadow-xs transition-colors group-hover:border-accent/40">
        <Globe className="size-4 shrink-0 text-text-muted" strokeWidth={1.5} />
        <span className="text-sm font-medium text-text-primary">
          {health.total} monitored {health.total === 1 ? "site" : "sites"}
        </span>
        <span className="flex items-center gap-1.5">
          {health.attention > 0 && <Badge tone="error">{health.attention} need attention</Badge>}
          {health.healthy > 0 && <Badge tone="success">{health.healthy} healthy</Badge>}
          {health.quiet > 0 && <Badge tone="neutral">{health.quiet} quiet</Badge>}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[13px] text-text-muted transition-colors group-hover:text-text-primary">
          Sites <ChevronRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}
