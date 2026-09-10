"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Two tabs, deliberately not merged: they run through different backends,
// keep history in different tables and take very different amounts of time.
// The tab is in the URL (?tab=devices) so a link lands on the right one.
// Drawn as a segmented control with the active pill sliding between them.
//
// The control itself is laid out by the active panel's shell, in its command
// bar beside the verdict — so it reaches the panel through context rather
// than being rendered here above it.

export type TabKey = "viewports" | "devices";

const TABS: { key: TabKey; label: string; explain: string }[] = [
  { key: "viewports", label: "Viewports",
    explain: "Your page rendered at eight widths in one browser. Fast, catches most responsive breaks." },
  { key: "devices", label: "Devices",
    explain: "Your page rendered on 14 device profiles across three browser engines. Slower, catches engine-specific problems." },
];

/** What the active panel's shell lays out: the tab control, whatever sits at
 *  the far right of the bar (the history menu), the one-line explanation
 *  while a tab has never run, and the attributes that make the stage-and-
 *  findings region this tab's panel. */
export type TabSlots = {
  tabs: ReactNode;
  right?: ReactNode;
  explain?: string;
  panelProps: { id: string; role: "tabpanel"; "aria-labelledby": string };
};

const TabSlotsContext = createContext<TabSlots | null>(null);

export function useTabSlots(): TabSlots | null {
  return useContext(TabSlotsContext);
}

export function SiteTabs({
  panels,
  explainFor,
  initial = "viewports",
  right,
}: {
  panels: Record<TabKey, ReactNode>;
  /** Which tabs still show the one-line explanation (until each has been run once). */
  explainFor: Record<TabKey, boolean>;
  initial?: TabKey;
  /** Sits at the far right of the command bar — the run history menu. */
  right?: ReactNode;
}) {
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  // The URL is the state. No React state to keep in sync, no effect to do it;
  // replaceState changes the address without a server round-trip and
  // useSearchParams re-renders from it.
  const tab: TabKey = fromUrl === "devices" || fromUrl === "viewports" ? fromUrl : initial;
  const refs = useRef<Record<TabKey, HTMLButtonElement | null>>({ viewports: null, devices: null });
  const reduce = useReducedMotion();

  // Focus follows an arrow-key switch. The control is rebuilt with the panel
  // it sits in, so focus goes to the new button once it exists — not to the
  // one about to be unmounted.
  const wantFocus = useRef<TabKey | null>(null);
  useEffect(() => {
    if (wantFocus.current === tab) { refs.current[tab]?.focus(); wantFocus.current = null; }
  }, [tab]);

  const select = useCallback((key: TabKey) => {
    const next = new URLSearchParams(window.location.search);
    next.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const j = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    wantFocus.current = TABS[j].key;
    select(TABS[j].key);
  };

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  const tabs = (
    <div role="tablist" aria-label="Layout checks" onKeyDown={onKey}
         className="inline-flex shrink-0 rounded-full bg-card-soft p-1 ring-1 ring-border-soft">
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
              "relative rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              on ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {on && (
              <motion.span
                layoutId="site-tab-pill"
                aria-hidden
                className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-border-soft"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <TabSlotsContext.Provider
      value={{
        tabs,
        right,
        explain: explainFor[active.key] ? active.explain : undefined,
        panelProps: { id: `panel-${active.key}`, role: "tabpanel", "aria-labelledby": `tab-${active.key}` },
      }}
    >
      {panels[active.key]}
    </TabSlotsContext.Provider>
  );
}
