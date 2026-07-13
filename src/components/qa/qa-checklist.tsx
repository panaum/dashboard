"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { CHECK_RESULTS, label, type CheckResult } from "@/lib/constants";
import { updateCheckItem } from "@/app/dashboard/clients/[clientId]/[projectId]/[pageId]/actions";
import { LiveLine } from "@/components/qa/still-true";
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
};

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
}: {
  items: Item[];
  path: Path;
  liveByName?: Record<string, LiveStatus>;
  incidentHref?: string | null;
}) {
  const [state, setState] = React.useState(items);
  const [, startTransition] = React.useTransition();
  const live = liveByName ?? {};

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
