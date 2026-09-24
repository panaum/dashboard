"use client";

import { createContext, useContext } from "react";

// The signed-in person's chosen time zone, from Personalization. Null means
// they have not picked one, and dates follow the browser as they always did.
// Outside the dashboard (the developer's board link) there is no provider,
// so it is the browser there too.

const Zone = createContext<string | null>(null);

export function TimeZoneProvider({ zone, children }: { zone: string | null; children: React.ReactNode }) {
  return <Zone.Provider value={zone}>{children}</Zone.Provider>;
}

/** The zone to format dates in: theirs, else the browser's. */
export function useTimeZone(): string | undefined {
  const chosen = useContext(Zone);
  if (chosen) return chosen;
  return typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
}
