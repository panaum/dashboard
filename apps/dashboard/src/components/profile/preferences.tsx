"use client";

import { useMemo, useState, useTransition } from "react";
import { saveNotification, saveTimeZone } from "@/app/dashboard/personalization/actions";
import { NOTIFY_KINDS, type NotifyColumn } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/** One switch per kind of Slack ping. Each saves as it flips, and flips back
 *  with the reason if the save is refused. */
export function NotificationSettings({ initial }: { initial: Record<NotifyColumn, boolean> }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const flip = (column: NotifyColumn) => {
    const next = !on[column];
    setOn((o) => ({ ...o, [column]: next }));
    setError(null);
    start(async () => {
      const r = await saveNotification({ column, on: next });
      if (r.error) { setOn((o) => ({ ...o, [column]: !next })); setError(r.error); }
    });
  };

  return (
    <div className="flex flex-col divide-y divide-border-soft">
      {NOTIFY_KINDS.map((k) => (
        <div key={k.column} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{k.label}</p>
            <p className="text-[13px] text-text-secondary">{k.hint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on[k.column]}
            aria-label={k.label}
            onClick={() => flip(k.column)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              on[k.column] ? "bg-accent" : "bg-border-soft",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 rounded-full bg-card shadow-sm transition-transform",
                on[k.column] ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      ))}
      {error && <p className="pt-3 text-xs text-error-strong" role="status">{error}</p>}
    </div>
  );
}

/** Pick a time zone, or follow the browser. Saves on change. */
export function TimeZoneSetting({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Every zone this browser knows, so the list and the server's check agree.
  const zones = useMemo(() => {
    try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
  }, []);
  const browser = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Time zone"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          setStatus(null);
          start(async () => {
            const r = await saveTimeZone({ timeZone: next || null });
            if (r.error) { setValue(before); setStatus(r.error); } else setStatus("Saved.");
          });
        }}
        className="h-10 w-full rounded-lg border border-border-soft bg-card px-3 text-sm text-text-primary outline-none focus:border-accent/50"
      >
        <option value="" suppressHydrationWarning>Follow my browser{browser ? ` (${browser})` : ""}</option>
        {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
      </select>
      <p className="text-[13px] text-text-secondary">
        Used for dates on cards and for the time in your due-date reminders.
        {status && <span className={status === "Saved." ? " text-text-secondary" : " text-error-strong"}> {status}</span>}
      </p>
    </div>
  );
}
