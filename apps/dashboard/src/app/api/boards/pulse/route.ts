import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { latestActivity, presentOn, typingOn, typingLine } from "@/lib/board-alive";

// THE BOARD'S HEARTBEAT — and the reason it is a heartbeat rather than a socket.
//
// Step 0 of the spec asked whether any realtime transport already exists here.
// It does not, and the one that looks like it isn't one: the only WebSocket in
// this app (components/layout-checks/live-session.tsx) dials the devicepreview
// service on Railway, which can hold a connection open. Vercel functions
// cannot, so nothing in the Dashboard can host a socket.
//
// Supabase Realtime is technically present — the `supabase_realtime`
// publication exists in our database — but building on it would mean adding
// @supabase/supabase-js, shipping an anon key to the browser, adding tables to
// the publication and writing RLS policies where today there are none. And it
// would still not serve the developer, whose only credential is a capability
// token in a URL: there is no Supabase identity to write a policy against.
//
// So: polling, every 6 seconds while a board is on screen. That is not
// realtime and is not described as such anywhere in the UI; at this interval
// it reads as alive, costs two small queries, and needs no new infrastructure.
//
// One honest limitation, stated because it shapes the UI: a developer holding
// a board link is not a person. The link identifies a board, not a viewer, so
// an anonymous viewer is never recorded as present. Where the developer's
// identity IS knowable — a card they are the assignee of — they are attributed
// exactly as every other developer action is.

export const dynamic = "force-dynamic";

type Body = {
  projectId?: string;
  boardShareId?: string;
  /** The card currently open, if any — what this viewer wants to hear about. */
  issueId?: string | null;
  /** Whether this viewer's composer has text in it. Separate from `issueId`:
   *  reading "someone is typing" and claiming to be typing are different acts,
   *  and conflating them meant a reader never asked about the card they had
   *  open, so the line never appeared. */
  typing?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const now = new Date();

  // Who is asking, if anyone nameable.
  let viewerId: string | null = null;
  let projectId: string | null = null;

  const actor = await getActor();
  if (!actor && !body.boardShareId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (actor) {
    // The shared team login is nobody in particular, so it watches without
    // being watched: it reads presence and writes none of its own.
    viewerId = actor.bootstrap ? null : actor.id;
    projectId = body.projectId ?? null;
  }

  if (!projectId && body.boardShareId) {
    const project = await db.project.findUnique({
      where: { boardShareId: body.boardShareId },
      select: { id: true },
    });
    if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
    projectId = project.id;
    // The link is not a person. Only a card the asker is assigned to can name
    // them — the same resolution every other developer action uses.
    if (!viewerId && body.typing && body.issueId) {
      const card = await db.issue.findFirst({
        where: { id: body.issueId, page: { projectId: project.id } },
        select: { assigneeId: true },
      });
      viewerId = card?.assigneeId ?? null;
    }
  }

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Beat. A typing stamp is only written while there is actually text.
  if (viewerId) {
    const typing = body.typing && body.issueId ? body.issueId : null;
    await db.boardPresence.upsert({
      where: { memberId: viewerId },
      create: { memberId: viewerId, projectId, seenAt: now, typingIssueId: typing, typingAt: typing ? now : null },
      update: { projectId, seenAt: now, typingIssueId: typing, typingAt: typing ? now : null },
    });
  }

  const [rows, issueAgg, lastMove, lastComment] = await Promise.all([
    db.boardPresence.findMany({
      where: { projectId },
      select: { memberId: true, projectId: true, seenAt: true, typingIssueId: true, typingAt: true, member: { select: { name: true } } },
    }),
    db.issue.aggregate({ where: { page: { projectId }, boardStage: { not: null } }, _max: { updatedAt: true }, _count: true }),
    // The newest move and the newest comment, each WITH the person who did it.
    // The actor is what lets the client tell "somebody did something" from
    // "you did something", which is the difference between a useful chime and
    // one that gets muted.
    db.issueEvent.findFirst({
      where: { issue: { page: { projectId } } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, actorId: true },
    }),
    db.issueComment.findFirst({
      where: { issue: { page: { projectId } } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, authorId: true },
    }),
  ]);

  const presence = rows.map((r) => ({
    memberId: r.memberId, name: r.member.name, projectId: r.projectId,
    seenAt: r.seenAt, typingIssueId: r.typingIssueId, typingAt: r.typingAt,
  }));

  // A cheap fingerprint of "has anything on this board changed": the newest
  // card, event and comment, plus the card count so a deletion moves it too.
  // The client refreshes when it changes, which is what makes a board move
  // without anyone pressing anything.
  const version = [
    issueAgg._count,
    issueAgg._max.updatedAt?.getTime() ?? 0,
    lastMove?.createdAt.getTime() ?? 0,
    lastComment?.createdAt.getTime() ?? 0,
  ].join("-");

  const activity = latestActivity([
    lastMove && { at: lastMove.createdAt.toISOString(), actorId: lastMove.actorId },
    lastComment && { at: lastComment.createdAt.toISOString(), actorId: lastComment.authorId },
  ]);

  return NextResponse.json({
    version,
    activity,
    present: presentOn(presence, projectId, now, viewerId),
    typing: body.issueId
      ? typingLine(typingOn(presence, body.issueId, now, viewerId))
      : null,
  });
}
