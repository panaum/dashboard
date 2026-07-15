import { NextRequest, NextResponse } from "next/server";
import { clientSites } from "@/lib/registry";

// Proxy for the site picker (key stays server-side). Unavailable → 200
// { unavailable: true }.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return NextResponse.json(await clientSites(clientId));
}
