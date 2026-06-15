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
}: {
  certId: string;
  status: string;
  path: Path;
}) {
  const [value, setValue] = React.useState(status);
  const [, startTransition] = React.useTransition();

  const choose = (s: CertStatus) => {
    setValue(s);
    startTransition(() => {
      setCertStatus({ certId, status: s, path });
    });
  };

  return (
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
  );
}
