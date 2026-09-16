// The 3D handset preference: off unless someone turned it on, and remembered
// in this browser once they have. Internal tooling only — see
// src/components/layout-checks/handset-3d.tsx. Which devices have a model is
// src/lib/layout-checks/models-3d.ts.

import { useSyncExternalStore } from "react";

export const STORAGE_KEY = "layout-checks.frame3d";
const CHANGED = "layout-checks:frame3d";

type Store = Pick<Storage, "getItem" | "setItem">;

// What this page last set, when storage would not keep it (a private window,
// blocked site data): the toggle still works for the visit, it just is not
// remembered.
let memory: boolean | null = null;

/** On only when "on" was stored; anything else, or no storage, is off. */
export function readFrame3d(store: Store | null): boolean {
  if (memory !== null) return memory;
  try {
    return store?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeFrame3d(store: Store | null, on: boolean): void {
  memory = on;
  try {
    store?.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; `memory` carries it for this visit.
  }
}

/** For tests: forget what this module was told. */
export function resetFrame3dMemory(): void {
  memory = null;
}

function storage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  // Another tab changing it reaches this one through "storage"; this tab's own
  // writes through CHANGED.
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) { memory = null; onChange(); }
  };
  window.addEventListener("storage", fromOtherTab);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", fromOtherTab);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** [on, set]. Off on the server and on first paint, so the flat frame is what
 *  renders first; a stored "on" takes effect as the page hydrates. */
export function useFrame3d(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => readFrame3d(storage()), () => false);
  const set = (next: boolean) => {
    writeFrame3d(storage(), next);
    window.dispatchEvent(new Event(CHANGED));
  };
  return [on, set];
}
