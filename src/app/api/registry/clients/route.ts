import { NextRequest, NextResponse } from "next/server";
import { searchClients } from "@/lib/registry";

// Proxy: the client picker searches through here so LINKSPY_API_KEY stays
// server-side. Unavailable → 200 { unavailable: true } (the UI degrades, never
// errors).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("search") ?? "";
  const r = await searchClients(q);
  return NextResponse.json(r);
}
