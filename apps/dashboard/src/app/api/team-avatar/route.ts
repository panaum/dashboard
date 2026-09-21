import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth";

// A team member's profile photo, from our own database — an internal image
// route like /api/layout-shot, and guarded the same way: the team session,
// verified here rather than trusted from the proxy. The board's capability
// link is deliberately NOT accepted; a developer holding one has no business
// knowing what the QA team look like.
//
// `?v=` carries avatarUpdatedAt, so a replaced photo appears at once while an
// unchanged one stays cached for a day.

export async function GET(req: NextRequest) {
  const unauthorized = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const m = await db.teamMember.findUnique({
    where: { id },
    select: { avatar: true, avatarType: true },
  });
  if (!m?.avatar || !m.avatarType) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(m.avatar), {
    status: 200,
    headers: {
      "Content-Type": m.avatarType,
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
