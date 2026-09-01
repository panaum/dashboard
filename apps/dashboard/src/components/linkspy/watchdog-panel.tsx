import { Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// WATCHDOG PANEL (spec §2, below the grid) — inventory of every third-party
// host the monitored sites load; down hosts first. Portfolio-wide, one load,
// no polling. Server component: data arrives from the page.

type Host = {
  host: string;
  resource_type?: string | null;
  status?: string | null;
  down: boolean;
  affected_sites: number;
  sites: Array<{ site_id?: string; site_url?: string; client?: string | null }>;
};

export function WatchdogPanel({
  data,
}: {
  data: { hosts: Host[]; outages?: number; total_hosts?: number } | null;
}) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Third-party watchdog</CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-[13px] text-error">
            The watchdog did not answer — host inventory is unavailable right now.
          </p>
        ) : data.hosts.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Radio className="size-4" strokeWidth={1.75} />
            Nothing scanned yet — the host inventory builds up as scans run.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {[...data.hosts]
                .sort((a, b) => Number(b.down) - Number(a.down))
                .map((h) => (
                  <li key={h.host} className="flex items-center gap-2.5 text-[13px]">
                    <Badge tone={h.down ? "error" : "neutral"}>
                      {h.down ? "Down" : "Up"}
                    </Badge>
                    <span className="font-mono text-text-primary">{h.host}</span>
                    {h.resource_type && (
                      <span className="text-text-muted">{h.resource_type}</span>
                    )}
                    <span className="ml-auto text-text-muted">
                      {h.affected_sites} site{h.affected_sites === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="mt-3 text-[12px] text-text-muted">
              A provider outage never counts against a client&apos;s health score.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
