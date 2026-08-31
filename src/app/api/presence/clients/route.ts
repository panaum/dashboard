import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClientPresenceMany } from "@/lib/linkspy/client-presence";
import { presenceEnabled } from "@/lib/linkspy/chips-shape";
import { requireApiAuth } from "@/lib/auth";

// Client-list dots. Fetched AFTER paint so the directory never waits on
// LinkSpy — a dot that appears late is fine; a list that renders late is not.
//
// Session-guarded IN THIS HANDLER — `src/proxy.ts` matches /dashboard/* only and
// never covered /api/*, so the middleware does not protect this route (it also
// only sniffs for the cookie, not its signature). Read-only, and it returns only
// what a dot needs: worst state and one line of tooltip. No site ids, no chip
// internals, nothing that isn't already on screen elsewhere.

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (!presenceEnabled()) return NextResponse.json({ enabled: false });

  const clients = await db.client
    .findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    .catch(() => []);
  if (!clients.length) return NextResponse.json({ enabled: true, clients: {} });

  const presences = await getClientPresenceMany(clients);

  const out: Record<string, { worst: string; summary: string }> = {};
  for (const p of presences) {
    // The tooltip names the worst chip by name, so the dot is never a verdict
    // without a cause — one click through shows all four.
    const worstChip = p.chips.find((c) => c.state === p.worst);
    out[p.clientId] = {
      worst: p.worst,
      summary: worstChip ? `${worstChip.label} ${worstChip.text}` : `${p.siteCount} site(s) monitored`,
    };
  }
  return NextResponse.json({ enabled: true, clients: out });
}
