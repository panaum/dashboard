"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CERT_STATUSES, label, type CertStatus } from "@/lib/constants";
import { setCertStatus } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";

type Path = { clientId: string; projectId: string; pageId: string };

const TONE: Record<CertStatus, string> = {
  IN_PROGRESS: "text-warning",
  PASS: "text-success",
  FAIL: "text-error",
};

export function CertStatusControl({
  certId,
  status,
  path,
  canSign,
  cannotReason,
}: {
  certId: string;
  status: string;
  path: Path;
  /** canSignQa for this person on this page, decided on the server — it
   *  depends on who built the page, not only on rank. */
  canSign: boolean;
  cannotReason?: string;
}) {
  const [value, setValue] = React.useState(status);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  // Someone who may not give a verdict sees the verdict, not the switch.
  if (!canSign) {
    const s = (CERT_STATUSES as readonly string[]).includes(status) ? (status as CertStatus) : "IN_PROGRESS";
    return (
      <span className="rounded-full bg-card-soft px-3 py-1.5 text-xs font-semibold" title={cannotReason}>
        <span className={TONE[s]}>{label(s)}</span>
      </span>
    );
  }

  const choose = (s: CertStatus) => {
    const before = value;
    setValue(s);
    setError(null);
    startTransition(async () => {
      // The server re-checks; if it refuses, put the switch back and say why
      // rather than showing a verdict that was never saved.
      const r = await setCertStatus({ certId, status: s, path });
      if (r && "error" in r && r.error) { setValue(before); setError(r.error); }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
    {error && <span className="text-xs text-error-strong" role="status">{error}</span>}
    <div className="flex gap-1 rounded-full bg-card-soft p-1">
      {CERT_STATUSES.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => choose(s)}
            className="relative rounded-full px-3 py-1 text-xs font-semibold"
          >
            {active && (
              <motion.span
                layoutId="cert-status"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 rounded-full bg-card shadow-xs"
              />
            )}
            <span className={`relative z-10 ${active ? TONE[s] : "text-text-muted"}`}>
              {label(s)}
            </span>
          </button>
        );
      })}
    </div>
    </div>
  );
}
