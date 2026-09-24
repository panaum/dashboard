"use client";

import { createContext, useContext } from "react";
import type { Capability } from "@/lib/permissions";

// What the signed-in person may do, handed to client components once by the
// dashboard layout rather than threaded through every prop. Hiding a control
// is a courtesy — each server action checks for itself (see
// server-actions.guard.test.ts) — but a control nobody can use should not
// render at all: absent, like severity on the developer board, not greyed.

const Capabilities = createContext<readonly Capability[]>([]);

export function CapabilityProvider({ caps, children }: { caps: readonly Capability[]; children: React.ReactNode }) {
  return <Capabilities.Provider value={caps}>{children}</Capabilities.Provider>;
}

/** Whether the person holds the capability. `undefined` means the control
 *  asks for nothing, so it shows — the optional `cap` props rely on that. */
export function useCan(capability: Capability | undefined): boolean {
  const caps = useContext(Capabilities);
  return capability === undefined || caps.includes(capability);
}

/** Render children only for someone holding the capability. */
export function Can({ cap, children }: { cap: Capability; children: React.ReactNode }) {
  return useCan(cap) ? <>{children}</> : null;
}
