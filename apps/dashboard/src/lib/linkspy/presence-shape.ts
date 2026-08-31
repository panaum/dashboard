// PRESENCE (Seam 3) — pure shaping for the production-presence strip. No I/O,
// no secrets, no React: every state the strip can be in is decided here and is
// therefore unit-testable without a network or a renderer.
//
// The strip's contract: it is QUIET BY DEFAULT. Zero signals means the strip is
// not rendered at all — there is deliberately no "all good" state, because a
// band that is usually empty is a band people actually read when it isn't.

export type PresenceSeverity = "critical" | "warn";

export type PresenceSignal = {
  key: string;
  severity: PresenceSeverity;
  text: string;
  qualifier: string | null;
  deep_link_path: string | null;
};

// The wire shape of GET /api/qa-bridge/presence on LinkSpy.
export type PresencePayload = {
  registry_site_id: string;
  as_of: string;
  last_checked: string | null;
  open_incidents: number;
  site_path: string | null;
  signals: PresenceSignal[];
};

// What the component actually renders.
export type PresenceView =
  | { render: false }
  | { render: true; kind: "signals"; signals: PresenceSignal[]; asOf: string; stale: boolean }
  | { render: true; kind: "unavailable" };

// The flag. Read server-side only, and only ever "1" counts — an operator who
// types PRESENCE=true gets today's view, not a half-on feature.
export function presenceEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PRESENCE === "1";
}

function isSignal(v: unknown): v is PresenceSignal {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.key === "string" &&
    (s.severity === "critical" || s.severity === "warn") &&
    typeof s.text === "string" &&
    s.text.length > 0
  );
}

// Defensive: an older/newer LinkSpy may add fields or send something odd. Never
// throw on the render path — drop what we don't understand and show the rest.
export function normalize(payload: unknown): PresenceSignal[] {
  const raw = (payload as PresencePayload | null)?.signals;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSignal).map((s) => ({
    key: s.key,
    severity: s.severity,
    text: s.text,
    qualifier: typeof s.qualifier === "string" ? s.qualifier : null,
    deep_link_path:
      typeof s.deep_link_path === "string" && s.deep_link_path.startsWith("/")
        ? s.deep_link_path
        : null,
  }));
}

/**
 * The single decision function for the strip.
 *
 * - flag off              → never render (byte-identical to today's page)
 * - no linked site        → never render
 * - reachable, 0 signals  → never render (quiet by design)
 * - reachable, N signals  → render the lines
 * - unreachable + cache   → render last-known-good, marked stale
 * - unreachable, no cache → one muted "unavailable" line, never an error
 */
export function decidePresence(input: {
  enabled: boolean;
  registrySiteId: string | null | undefined;
  payload: PresencePayload | null;
  unreachable: boolean;
  stale?: boolean;
}): PresenceView {
  if (!input.enabled) return { render: false };
  if (!input.registrySiteId) return { render: false };

  if (!input.payload) {
    return input.unreachable ? { render: true, kind: "unavailable" } : { render: false };
  }

  const signals = normalize(input.payload);
  if (signals.length === 0) return { render: false };

  return {
    render: true,
    kind: "signals",
    signals,
    asOf: input.payload.as_of,
    stale: Boolean(input.stale),
  };
}
