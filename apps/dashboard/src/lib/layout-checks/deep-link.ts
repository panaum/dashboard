// The URL as the record of what is being looked at.
//
// A QA finding's destination is a developer, and until now the device and the
// selected finding lived only in React state — there was no link to "this
// finding, on this device". Now the panels keep them in the query string:
// ?tab= belongs to SiteTabs; device=, width= and finding= belong here. Written
// with replaceState, so a click changes the address without a navigation or a
// history entry, and read back on load, validated against what the run
// actually has, so a stale link lands on the default rather than on nothing.

/** What the Devices tab was asked to show. Unknown devices are ignored. */
export function readDeviceView(params: URLSearchParams, knownDevices: string[]): { device: string | null; finding: string | null } {
  const device = params.get("device");
  return {
    device: device && knownDevices.includes(device) ? device : null,
    finding: cleanFinding(params.get("finding")),
  };
}

/** What the Viewports tab was asked to show. Unknown widths are ignored. */
export function readWidthView(params: URLSearchParams, knownWidths: number[]): { width: number | null; finding: string | null } {
  const raw = params.get("width");
  const width = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return {
    width: width !== null && knownWidths.includes(width) ? width : null,
    finding: cleanFinding(params.get("finding")),
  };
}

// Rail ids are an index ("3") or engine-qualified in comparison ("gecko:3").
// Anything else is not a finding id and is dropped rather than carried around.
function cleanFinding(raw: string | null): string | null {
  return raw && /^[a-z0-9]+(?::[0-9]+)?$/i.test(raw) && raw.length <= 24 ? raw : null;
}

/** `search` with `patch` applied: a null or empty value removes the key,
 *  everything else is preserved. Returns "" or "?k=v…". */
export function withQuery(search: string, patch: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams(search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Put the view in the address bar without a navigation. No-op on the server
 *  and when nothing would change. */
export function syncQuery(patch: Record<string, string | number | null | undefined>): void {
  if (typeof window === "undefined") return;
  const next = withQuery(window.location.search, patch);
  if (next === window.location.search) return;
  window.history.replaceState(null, "", `${window.location.pathname}${next}`);
}

/** The absolute link to the current page with `patch` applied — what goes
 *  into copied text so the reader can open exactly this view. */
export function viewLink(patch: Record<string, string | number | null | undefined>): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${window.location.pathname}${withQuery(window.location.search, patch)}`;
}
