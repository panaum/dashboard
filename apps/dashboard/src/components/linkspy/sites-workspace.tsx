"use client";

import { useCallback, useState } from "react";
import { UrlChecker } from "@/components/linkspy/url-checker";

// TWO-STEP SITES PAGE. Step 1: the portfolio — stat rail, site grid, watchdog.
// Step 2: one scan, on its own. Looking into a single page's results should
// not leave the whole portfolio stacked underneath it, so the scanner takes
// the page over while it runs and while its results are up, and the "All
// sites" control inside it returns here.
//
// `children` is the server-rendered portfolio; it stays mounted (just hidden)
// so stepping back is instant and nothing refetches.

export function SitesWorkspace({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  const onFocusChange = useCallback((v: boolean) => setFocused(v), []);

  return (
    <>
      <UrlChecker onFocusChange={onFocusChange} />
      <div className={focused ? "hidden" : undefined}>{children}</div>
    </>
  );
}
