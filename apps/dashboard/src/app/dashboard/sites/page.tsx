import Link from "next/link";
import { Globe, Radar, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listRegistrySites,
  linkedPageCounts,
  fetchSiteChips,
} from "@/lib/linkspy/sites-data";
import { buildSitesList, STATE_TONE, STATE_LABEL } from "@/lib/linkspy/sites-view";

export const metadata = { title: "Sites" };
export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const sites = await listRegistrySites();

  if (sites === null) {
    return (
      <div>
        <PageHeader
          title="Sites"
          subtitle="Live monitoring from LinkSpy, inside the dashboard."
        />
        <EmptyState
          icon={Radar}
          title="LinkSpy is unavailable right now"
          description="The registry did not answer. Nothing is wrong with your data — reload in a minute, or open LinkSpy from the sidebar."
        />
      </div>
    );
  }

  const ids = sites.map((s) => s.id);
  const [chips, linked] = await Promise.all([fetchSiteChips(ids), linkedPageCounts(ids)]);
  const items = buildSitesList(sites, chips, linked);

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Live monitoring from LinkSpy, inside the dashboard. A site appears here once a LinkSpy operator assigns it to a client."
        action={
          /* A hop into LinkSpy's checker, URL prefilled — the scan itself runs
             there (long-lived, session-driven), so this opens a new tab. */
          <form action="/dashboard/linkspy" method="GET" target="_blank" className="flex items-center gap-2">
            <input
              type="text"
              name="url"
              required
              placeholder="Check a URL…"
              className="w-56 rounded-lg border border-border-soft bg-card px-3 py-2 text-sm text-text-primary shadow-xs placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-opacity hover:opacity-90"
            >
              <ScanSearch className="size-4" strokeWidth={1.75} /> Scan
            </button>
          </form>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sites are visible yet"
          description="LinkSpy exposes a site here once it has a client assigned. Open LinkSpy from the sidebar to assign clients to sites."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((s) => (
            <Link key={s.id} href={`/dashboard/sites/${s.id}`}>
              <Card hover className="flex items-center gap-4 px-5 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card-soft text-text-muted">
                  <Globe className="size-4.5" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {s.host ?? s.url ?? s.id}
                  </p>
                  <p className="truncate text-[13px] text-text-secondary">
                    {s.clientName}
                    {s.linkedPages > 0 &&
                      ` · ${s.linkedPages} linked ${s.linkedPages === 1 ? "page" : "pages"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.chips.map((c) => (
                    <Badge key={c.key} tone={STATE_TONE[c.state]} title={c.detail ?? c.text}>
                      {c.label}
                    </Badge>
                  ))}
                  <Badge tone={STATE_TONE[s.worst]}>{STATE_LABEL[s.worst]}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
