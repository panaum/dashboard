import { NextRequest, NextResponse } from "next/server";
import { clientSites } from "@/lib/registry";
import { requireApiAuth } from "@/lib/auth";

// Proxy for the site picker (key stays server-side). Unavailable → 200
// { unavailable: true }.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const { clientId } = await params;
  return NextResponse.json(await clientSites(clientId));
}
