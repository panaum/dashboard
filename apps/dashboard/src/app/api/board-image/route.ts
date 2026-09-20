import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";

// Serves a card image from our own database, like /api/layout-shot — but two
// kinds of reader reach it. QA has the session. The developer has only the
// board's capability link, so the same token that opens /b/{boardShareId} is
// accepted here, and only for images on cards inside that board. Neither path
// makes the image public: without one credential or the other it is a 404,
// the same answer as "no such image", so the route cannot be used to probe.

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const img = await db.issueImage.findUnique({
    where: { id },
    select: {
      image: true, contentType: true,
      issue: { select: { page: { select: { project: { select: { boardShareId: true } } } } } },
    },
  });
  const notFound = NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!img) return notFound;

  const share = req.nextUrl.searchParams.get("share");
  const boardToken = img.issue.page.project.boardShareId;
  const viaLink = !!share && !!boardToken && share === boardToken;
  if (!viaLink && !(await isAuthenticated())) return notFound;

  return new NextResponse(new Uint8Array(img.image), {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
