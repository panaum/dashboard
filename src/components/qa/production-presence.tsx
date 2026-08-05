// PRODUCTION PRESENCE — a quiet awareness strip: what LinkSpy is seeing in
// production for this page's linked site, right now.
//
// Presentational only. Every decision (render / don't, which signals, stale?)
// was already made server-side in lib/linkspy/presence-shape.ts, and the handoff
// links were already signed. This file only formats.
//
// It renders NOTHING when there is nothing to say. No "all clear" state.
import { TriangleAlert, Radio, ExternalLink } from "lucide-react";
import type { PresenceView } from "@/lib/linkspy/presence-shape";
import { fmtUtc } from "./still-true";

export function ProductionPresence({
  view,
  hrefByKey,
}: {
  view: PresenceView;
  hrefByKey: Record<string, string>;
}) {
  if (!view.render) return null;

  if (view.kind === "unavailable") {
    // The honest quiet state: we don't know, and we say so in one muted line
    // rather than showing an error on a page that has nothing to do with it.
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border-soft bg-card-soft px-4 py-2.5 text-xs text-text-muted">
        <Radio className="size-3.5 shrink-0" />
        Production status unavailable
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-brand-purple/40 bg-brand-purple/10 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio className="size-4 shrink-0 text-brand-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
            Production presence
          </span>
        </div>
        <span className="text-xs text-text-muted">
          {view.stale ? "last seen " : "as of "}
          {fmtUtc(view.asOf)}
        </span>
      </div>

      {/* One line per signal, most urgent first (LinkSpy sorted them). */}
      <div className="flex flex-col gap-1.5">
        {view.signals.map((s) => {
          const href = hrefByKey[s.key];
          const body = (
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert
                className={`size-3.5 shrink-0 ${s.severity === "critical" ? "text-error" : "text-warning"}`}
              />
              <span className="font-medium text-text-primary">{s.text}</span>
              {s.qualifier && <span className="text-text-secondary">· {s.qualifier}</span>}
              {href && <ExternalLink className="size-3 shrink-0 text-text-muted" />}
            </span>
          );
          return (
            <div key={s.key} className="text-[13px] leading-5">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-transparent underline-offset-2 hover:decoration-current"
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
