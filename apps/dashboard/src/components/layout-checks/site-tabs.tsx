"use client";

import { useCallback, useRef, type ReactNode, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Two tabs, deliberately not merged: they run through different backends,
// keep history in different tables and take very different amounts of time.
// The tab is in the URL (?tab=devices) so a link lands on the right one.

export type TabKey = "viewports" | "devices";

const TABS: { key: TabKey; label: string; explain: string }[] = [
  { key: "viewports", label: "Viewports",
    explain: "Your page rendered at eight widths in one browser. Fast, catches most responsive breaks." },
  { key: "devices", label: "Devices",
    explain: "Your page rendered on 14 device profiles across three browser engines. Slower, catches engine-specific problems." },
];

export function SiteTabs({
  panels,
  explainFor,
  initial = "viewports",
}: {
  panels: Record<TabKey, ReactNode>;
  /** Which tabs still show the one-line explanation (until each has been run once). */
  explainFor: Record<TabKey, boolean>;
  initial?: TabKey;
}) {
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  // The URL is the state. No React state to keep in sync, no effect to do it;
  // replaceState changes the address without a server round-trip and
  // useSearchParams re-renders from it.
  const tab: TabKey = fromUrl === "devices" || fromUrl === "viewports" ? fromUrl : initial;
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({ viewports: null, devices: null });

  const select = useCallback((key: TabKey) => {
    const next = new URLSearchParams(window.location.search);
    next.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, []);

  // Arrow keys move between tabs, as a tablist should; focus follows.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const j = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[j].key);
    refs.current[TABS[j].key]?.focus();
  };

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div role="tablist" aria-label="Layout checks" onKeyDown={onKey}
             className="flex gap-1 border-b border-border-soft">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                ref={(el) => { refs.current[t.key] = el; }}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={on}
                aria-controls={`panel-${t.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => select(t.key)}
                className={cn(
                  "-mb-px rounded-t-md px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                  on ? "border-b-2 border-accent text-accent" : "border-b-2 border-transparent text-text-secondary hover:text-text-primary",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {explainFor[active.key] && (
          <p className="mt-3 text-[13px] text-text-secondary">{active.explain}</p>
        )}
      </div>
      <div role="tabpanel" id={`panel-${active.key}`} aria-labelledby={`tab-${active.key}`}>
        {panels[active.key]}
      </div>
    </div>
  );
}
