"use client";

import { useState } from "react";

// Tabs for the site detail page. The six panels were a single scrolling column
// — everything at once, nothing in focus. Grouping them means one subject on
// screen at a time. Panels are server-rendered and passed in as children, so
// switching tabs costs nothing and refetches nothing.

export type SiteTabKey = "overview" | "promises" | "privacy" | "history";

const TABS: Array<{ key: SiteTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "promises", label: "Promises" },
  { key: "privacy", label: "Privacy" },
  { key: "history", label: "History" },
];

export function SiteTabs({
  overview, promises, privacy, history,
}: Record<SiteTabKey, React.ReactNode>) {
  const [tab, setTab] = useState<SiteTabKey>("overview");
  const panels: Record<SiteTabKey, React.ReactNode> = { overview, promises, privacy, history };

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 border-b border-border-soft">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-4">{panels[tab]}</div>
    </div>
  );
}
