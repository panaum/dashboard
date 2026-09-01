import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildIntentMapView, verdictTone, type IntentMapPayload } from "@/lib/linkspy/intent-consent-view";
import { middleTruncate } from "@/lib/linkspy/monitor-metrics";

// PROMISE MAP (spec §3.2) — every conversion promise the site's links make
// and whether the destination honors it. Read-only from the latest scan.

export function PromiseMap({ payload }: { payload: IntentMapPayload | null }) {
  const view = buildIntentMapView(payload);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Promise map</CardTitle>
      </CardHeader>
      <CardContent>
        {view.state === "unavailable" && (
          <p className="text-[13px] text-text-secondary">
            LinkSpy did not answer — the promise map is unavailable right now.
          </p>
        )}
        {view.state === "no_scan" && (
          <p className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Target className="size-4" strokeWidth={1.75} />
            No scan yet — run a scan to map this site&apos;s promises.
          </p>
        )}
        {view.state === "no_promises" && (
          <p className="text-[13px] text-text-secondary">{view.verdict}</p>
        )}
        {view.state === "map" && (
          <>
            <p className="mb-3 text-sm text-text-primary">{view.verdict}</p>
            <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
              {[
                { label: "Conversion promises", value: view.counts.conversion_total },
                { label: "Honored", value: view.counts.honored },
                { label: "Broken", value: view.counts.broken },
                { label: "Unverified", value: view.counts.unverified },
              ].map((s) => (
                <span key={s.label} className="rounded-lg border border-border-soft bg-card-soft px-2.5 py-1.5">
                  <span className="font-mono font-semibold tabular-nums text-text-primary">{s.value}</span>
                  <span className="ml-1.5 text-text-muted">{s.label}</span>
                </span>
              ))}
            </div>
            <ul className="flex flex-col gap-1.5">
              {view.promises.map((p, i) => (
                <li
                  key={`${p.url}-${i}`}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
                    p.verdict === "broken" ? "bg-error/5" : ""
                  }`}
                >
                  <Badge tone={verdictTone(p.verdict)}>{p.verdict}</Badge>
                  <span className="font-medium text-text-primary">{p.label}</span>
                  {p.anchor && p.anchor !== p.label && (
                    <span className="text-text-muted">“{p.anchor}”</span>
                  )}
                  <span
                    className="ml-auto truncate font-mono text-[12px] text-text-muted"
                    title={p.final_url ?? p.url}
                  >
                    {middleTruncate(p.final_url || p.url)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
