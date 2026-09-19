"use client";

import { motion } from "framer-motion";
import { TrackingConsistency, TrackingFinding } from "@/types";

/**
 * Site-wide tracking consistency.
 *
 * Every other panel on this page counts links. This one compares pages: GA4 on
 * 34 of 37 is invisible from any single page, and it is the shape of the site
 * that tells you something is missing.
 *
 * A SKIP is rendered, not hidden. "We could not establish this" is a different
 * statement from "this is fine", and a panel that disappears when it has
 * nothing to say reads as the second.
 */

const STATUS_STYLES: Record<TrackingFinding["status"], string> = {
  PASS: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  WARN: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  INFO: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  SKIP: "bg-white/5 text-white/50 border-white/10",
  FAIL: "bg-rose-500/10 text-rose-300 border-rose-500/25",
};

export default function TrackingConsistencyPanel({
  data,
}: {
  data?: TrackingConsistency | null;
}) {
  if (!data?.enabled || !data.findings?.length) return null;

  const { coverage = [], pages_read: pagesRead, findings } = data;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="ds-container w-full mt-8 px-6"
      aria-label="Tracking consistency across the site"
    >
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <header className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-medium text-white/80">Tracking consistency</h3>
          <span className="text-xs tabular-nums text-white/40">
            {pagesRead} {pagesRead === 1 ? "page" : "pages"} compared
          </span>
        </header>

        {coverage.length > 0 && (
          <ul className="mt-4 grid gap-1.5">
            {coverage.map((c) => {
              const have = c.pages_with.length;
              const complete = have === pagesRead;
              return (
                <li
                  key={`${c.vendor}-${c.id ?? "unidentified"}`}
                  className="flex items-center justify-between gap-4 text-xs"
                >
                  <span className="truncate text-white/70">
                    {c.vendor_label}{" "}
                    <span className="font-mono text-white/40">
                      {c.id ?? "id not readable"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${
                      complete ? "text-white/40" : "text-amber-300/80"
                    }`}
                  >
                    {have}/{pagesRead}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <ul className="mt-4 grid gap-3">
          {findings.map((f) => (
            <li key={f.id} className="grid gap-1.5">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${
                    STATUS_STYLES[f.status] ?? STATUS_STYLES.SKIP
                  }`}
                >
                  {f.status}
                </span>
                <span className="text-xs text-white/80">{f.title}</span>
              </div>
              {f.detail && <p className="pl-[3.25rem] text-xs text-white/50">{f.detail}</p>}
              {f.evidence?.length > 0 && (
                <ul className="pl-[3.25rem] grid gap-0.5">
                  {f.evidence.map((e) => (
                    <li key={e} className="truncate font-mono text-[11px] text-white/40">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
