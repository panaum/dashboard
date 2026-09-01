import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  buildConsentView, cappedRequests, requestClassTone, type ConsentPayload,
} from "@/lib/linkspy/intent-consent-view";

// CONSENT PANEL (spec §3.5) — an observation ledger of cookie/consent
// behavior. Records third-party requests per enrolled page; NEVER a legal
// conclusion. The backend's scope_statement is rendered verbatim on every
// surface, and the request list says when it truncates.

export function ConsentPanel({ payload }: { payload: ConsentPayload | null }) {
  const view = buildConsentView(payload);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent behavior</CardTitle>
      </CardHeader>
      <CardContent>
        {view.state !== "unavailable" && view.scopeStatement && (
          <p className="mb-3 rounded-lg border border-border-soft bg-card-soft px-3 py-2 text-[12px] italic text-text-muted">
            {view.scopeStatement}
          </p>
        )}

        {view.state === "unavailable" && (
          <p className="text-[13px] text-text-secondary">
            LinkSpy did not answer — the consent ledger is unavailable right now.
          </p>
        )}

        {view.state === "empty" && (
          <p className="flex items-center gap-2 text-[13px] text-text-secondary">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            The ledger only records from enrollment forward — nothing observed yet.
          </p>
        )}

        {view.state === "sessions" && (
          <ul className="flex flex-col gap-3">
            {view.sessions.map((s) => {
              const { shown, hidden } = cappedRequests(s);
              return (
                <li key={s.id} className="rounded-lg border border-border-soft p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-mono text-text-primary">{s.page_url}</span>
                    {s.regime && <Badge tone="neutral">{s.regime}</Badge>}
                    {s.cmp && <span className="text-text-muted">CMP: {s.cmp}</span>}
                    {s.created_at && (
                      <span className="ml-auto text-[12px] text-text-muted">{s.created_at.slice(0, 10)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {shown.map((r, i) => (
                      <Badge key={`${r.host}-${i}`} tone={requestClassTone(r.class)} title={r.class ?? "request"}>
                        {r.host}
                        {typeof r.ms_after_load === "number" && (
                          <span className="ml-1 opacity-70">+{r.ms_after_load}ms</span>
                        )}
                      </Badge>
                    ))}
                  </div>
                  {hidden > 0 && (
                    <p className="mt-1.5 text-[12px] text-text-muted">
                      Showing 8 of {shown.length + hidden} third-party requests.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
