import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildConsentView, type ConsentPayload } from "@/lib/linkspy/intent-consent-view";
import { plainConsent, regimeSentence, GROUP_COPY } from "@/lib/linkspy/consent-plain";

// CONSENT PANEL — written for a non-technical reader. The raw ledger is
// repeated sessions of bare hostnames with millisecond offsets; nobody can act
// on that. This says what we did, which companies the page contacts, and what
// each kind of company does. Observation only — never a legal conclusion, and
// the backend's scope statement is rendered verbatim.

const DOT: Record<string, string> = {
  error: "bg-error", warning: "bg-warning", neutral: "bg-text-muted",
};

export function ConsentPanel({ payload }: { payload: ConsentPayload | null }) {
  const view = buildConsentView(payload);
  const pages = view.state === "sessions" ? plainConsent(view.sessions) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who this page shares visitors with</CardTitle>
      </CardHeader>
      <CardContent>
        {view.state === "unavailable" && (
          <p className="text-[13px] text-text-secondary">
            LinkSpy did not answer — this check is unavailable right now.
          </p>
        )}

        {view.state === "empty" && (
          <p className="flex items-center gap-2 text-[13px] text-text-secondary">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            No pages are being watched yet. Once a page is enrolled, we record every visit from then on.
          </p>
        )}

        {view.state === "sessions" && (
          <>
            <p className="mb-4 text-[13px] text-text-secondary">
              We open the page as a brand-new visitor and note every outside company it
              contacts. Below is what each one does.
            </p>

            <div className="flex flex-col gap-4">
              {pages.map((p) => (
                <div key={p.pageUrl} className="rounded-lg border border-border-soft p-3">
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-text-primary">
                      {p.totalCompanies} outside {p.totalCompanies === 1 ? "company" : "companies"}
                    </span>
                    <span className="truncate text-[12px] text-text-muted" title={p.pageUrl}>
                      on {p.pageUrl.replace(/^https?:\/\//, "")}
                    </span>
                    {p.lastChecked && (
                      <span className="ml-auto text-[12px] text-text-muted">
                        Last checked {p.lastChecked.slice(0, 10)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {p.groups.map((g) => {
                      const copy = GROUP_COPY[g.key];
                      return (
                        <div key={g.key} className="flex gap-2.5">
                          <span
                            aria-hidden
                            className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[copy.tone]}`}
                          />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-text-primary">
                              {copy.title}
                              <span className="ml-1.5 font-normal text-text-muted">
                                · {g.companies.length}
                              </span>
                            </p>
                            <p className="text-[12px] text-text-muted">{copy.blurb}</p>
                            <p className="mt-0.5 text-[13px] text-text-secondary">
                              {g.companies.join(", ")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="mt-3 border-t border-border-soft pt-2 text-[12px] text-text-muted">
                    {p.bannerSeen
                      ? "A cookie banner was found on this page."
                      : "No cookie banner was found on this page."}
                    {" "}
                    {regimeSentence(p.regimes)}
                    {p.checks > 1 && ` Based on ${p.checks} checks.`}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {view.state !== "unavailable" && view.scopeStatement && (
          <p className="mt-4 border-t border-border-soft pt-3 text-[12px] italic text-text-muted">
            {view.scopeStatement}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
