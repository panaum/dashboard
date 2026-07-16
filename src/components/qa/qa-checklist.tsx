"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { CHECK_RESULTS, label, type CheckResult } from "@/lib/constants";
import { updateCheckItem, confirmMachineItem, confirmAllMachinePassed } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";
import { LiveLine, fmtUtc } from "@/components/qa/still-true";
import type { LiveStatus } from "@/lib/linkspy/catalog-map";

type Item = {
  id: string;
  category: string;
  name: string;
  result: string;
  valueDesktop: string | null;
  valueMobile: string | null;
  hasDualValue: boolean;
  isMeasurement: boolean;
  confirmedSource?: string | null;
};

export type MachinePrefill = { verdict: string; detail: string | null; checkedAt: string | null };
const MV_LABEL: Record<string, string> = { holding: "PASS", failing: "FAIL", couldnt_verify: "couldn't verify" };
const MV_STYLE: Record<string, string> = { holding: "text-success", failing: "text-error", couldnt_verify: "text-text-muted" };
function verdictToResult(v: string): CheckResult {
  return v === "holding" ? "PASSED" : v === "failing" ? "FAILED" : "NA";
}

type Path = { clientId: string; projectId: string; pageId: string };

const RESULT_STYLE: Record<CheckResult, string> = {
  PASSED: "text-success",
  FAILED: "text-error",
  NA: "text-text-secondary",
};

function Segmented({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (v: CheckResult) => void;
  name: string;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-full bg-card-soft p-0.5">
      {CHECK_RESULTS.map((r) => {
        const active = value === r;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className="relative rounded-full px-3 py-1 text-xs font-semibold"
          >
            {active && (
              <motion.span
                layoutId={`seg-${name}`}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 rounded-full bg-card shadow-xs"
              />
            )}
            <span
              className={`relative z-10 ${active ? RESULT_STYLE[r] : "text-text-muted"}`}
            >
              {label(r)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function QAChecklist({
  items,
  path,
  liveByName,
  incidentHref,
  machineByName,
  prefillRunAt,
  deliverableId,
}: {
  items: Item[];
  path: Path;
  liveByName?: Record<string, LiveStatus>;
  incidentHref?: string | null;
  machineByName?: Record<string, MachinePrefill>;
  prefillRunAt?: string | null;
  deliverableId?: string | null;
}) {
  const [state, setState] = React.useState(items);
  const [, startTransition] = React.useTransition();
  const live = liveByName ?? {};
  const machine = machineByName ?? {};
  const [refreshing, setRefreshing] = React.useState(false);

  // Confirm is the ONLY bridge from a machine result into the human row.
  const confirmItem = (item: Item, m: MachinePrefill) => {
    setState((prev) => prev.map((it) => (it.id === item.id ? { ...it, result: verdictToResult(m.verdict), confirmedSource: "machine" } : it)));
    startTransition(() => {
      confirmMachineItem({ itemId: item.id, verdict: m.verdict, detail: m.detail, checkedAt: m.checkedAt, path });
    });
  };

  const machinePassedUnconfirmed = state.filter((i) => machine[i.name]?.verdict === "holding" && !i.confirmedSource);
  const confirmAllPassed = () => {
    const batch = machinePassedUnconfirmed.map((i) => ({ itemId: i.id, verdict: machine[i.name].verdict, detail: machine[i.name].detail, checkedAt: machine[i.name].checkedAt }));
    setState((prev) => prev.map((it) => (machine[it.name]?.verdict === "holding" && !it.confirmedSource ? { ...it, result: "PASSED", confirmedSource: "machine" } : it)));
    startTransition(() => { confirmAllMachinePassed({ path, items: batch }); });
  };

  const stale = Boolean(prefillRunAt) && Date.now() - new Date(prefillRunAt as string).getTime() > 3600_000;
  const refresh = async () => {
    if (!deliverableId) return;
    setRefreshing(true);
    await fetch(`/api/registry/prefills/refresh?deliverable_id=${encodeURIComponent(deliverableId)}`, { method: "POST" }).catch(() => {});
    setRefreshing(false);
  };

  const setResult = (id: string, result: CheckResult) => {
    setState((prev) =>
      prev.map((it) => (it.id === id ? { ...it, result } : it)),
    );
    startTransition(() => {
      updateCheckItem({ itemId: id, result, path });
    });
  };

  const setValue = (
    id: string,
    field: "valueDesktop" | "valueMobile",
    value: string,
  ) => {
    setState((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)),
    );
    startTransition(() => {
      updateCheckItem({ itemId: id, [field]: value, path });
    });
  };

  const total = state.length;
  const passed = state.filter((i) => i.result === "PASSED").length;
  const failed = state.filter((i) => i.result === "FAILED").length;
  const pct = total ? Math.round((passed / total) * 100) : 0;

  const categories = Array.from(new Set(state.map((i) => i.category)));

  return (
    <div className="flex flex-col gap-4">
      {/* Progress */}
      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-text-primary">QA progress</span>
          <span className="text-text-secondary">
            {passed} passed · {failed} failed · {total} checks
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-card-soft">
          <motion.div
            className="h-full rounded-full bg-success"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 30 }}
          />
        </div>
        {(machinePassedUnconfirmed.length > 0 || prefillRunAt) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {machinePassedUnconfirmed.length > 0 && (
              <button
                type="button"
                onClick={confirmAllPassed}
                className="rounded-full bg-success/10 px-3 py-1 font-semibold text-success hover:bg-success/20"
              >
                Confirm all machine-passed ({machinePassedUnconfirmed.length})
              </button>
            )}
            {prefillRunAt && (
              <span className="text-text-muted">machine checks as of {fmtUtc(prefillRunAt)}</span>
            )}
            {stale && deliverableId && (
              <button type="button" onClick={refresh} disabled={refreshing} className="text-text-secondary underline underline-offset-2 hover:text-text-primary">
                {refreshing ? "refreshing…" : "refresh checks"}
              </button>
            )}
          </div>
        )}
      </Card>

      {categories.map((cat) => (
        <Card key={cat} className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">{cat}</h3>
          <div className="flex flex-col divide-y divide-border-soft">
            {state
              .filter((i) => i.category === cat)
              // A live-failing item is promoted to the top of its section.
              .sort((a, b) => {
                const fa = live[a.name]?.verdict === "failing" ? 0 : 1;
                const fb = live[b.name]?.verdict === "failing" ? 0 : 1;
                return fa - fb;
              })
              .map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 sm:pr-4">
                    <span className="text-sm text-text-primary">{item.name}</span>
                    {live[item.name] && (
                      <LiveLine
                        status={live[item.name]}
                        delivered={item.result === "PASSED"}
                        incidentHref={incidentHref}
                      />
                    )}
                    {machine[item.name] && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className={MV_STYLE[machine[item.name].verdict]}>
                          machine-verified: {MV_LABEL[machine[item.name].verdict]}
                          {machine[item.name].detail ? ` — ${machine[item.name].detail}` : ""}
                          {machine[item.name].checkedAt ? ` · ${fmtUtc(machine[item.name].checkedAt)}` : ""}
                        </span>
                        {item.confirmedSource ? (
                          <span className="text-text-muted">confirmed ✓</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => confirmItem(item, machine[item.name])}
                            className="text-text-secondary underline underline-offset-2 hover:text-text-primary"
                          >
                            Confirm
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.hasDualValue && (
                      <>
                        <Input
                          aria-label={`${item.name} desktop`}
                          placeholder="Desktop"
                          defaultValue={item.valueDesktop ?? ""}
                          onBlur={(e) =>
                            setValue(item.id, "valueDesktop", e.target.value)
                          }
                          className="h-8 w-24 py-1 text-xs"
                        />
                        <Input
                          aria-label={`${item.name} mobile`}
                          placeholder="Mobile"
                          defaultValue={item.valueMobile ?? ""}
                          onBlur={(e) =>
                            setValue(item.id, "valueMobile", e.target.value)
                          }
                          className="h-8 w-24 py-1 text-xs"
                        />
                      </>
                    )}
                    {item.isMeasurement && !item.hasDualValue && (
                      <Input
                        aria-label={`${item.name} value`}
                        placeholder="e.g. 2.3s"
                        defaultValue={item.valueDesktop ?? ""}
                        onBlur={(e) =>
                          setValue(item.id, "valueDesktop", e.target.value)
                        }
                        className="h-8 w-28 py-1 text-xs"
                      />
                    )}
                    <Segmented
                      name={item.id}
                      value={item.result}
                      onChange={(v) => setResult(item.id, v)}
                    />
                  </div>
                </div>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
