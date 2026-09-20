import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { remindersDue } from "@/lib/board-dates";
import { escapeSlack } from "@/lib/board-thread";
import { postSlack } from "@/lib/slack";

// The due-date reminder sweep. Hit on a schedule by cron-job.org, the same
// way /api/spine/drain is:
//   curl -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<host>/api/boards/reminders
//
// Each call reports completed-vs-given: how many cards were in the window,
// how many pings went out, and every one that did not with the reason. A
// card is marked reminded only after Slack confirmed at least one delivery,
// so a failed sweep is retried by the next one, never counted as done.
//
// Protected by CRON_SECRET (caller sends `Authorization: Bearer <CRON_SECRET>`).

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not yet configured → allow (pre-activation), as the drain does
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const candidates = await db.issue.findMany({
    where: { dueAt: { not: null }, dueReminderMinutes: { not: null }, dueRemindedAt: null, boardStage: { in: ["NEW", "ACTIVE", "NEEDS_CLARIFICATION"] } },
    select: {
      id: true, title: true, dueAt: true, dueReminderMinutes: true, dueRemindedAt: true, boardStage: true,
      assignee: { select: { name: true, slackUserId: true, role: true } },
      reporter: { select: { name: true, slackUserId: true } },
      page: { select: { project: { select: { id: true, name: true, boardShareId: true } } } },
    },
  });
  const due = remindersDue(candidates, now);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const skipped: string[] = [];
  let sent = 0;
  for (const c of due) {
    const project = c.page.project;
    const when = c.dueAt!.toISOString();
    const targets = [
      c.assignee?.slackUserId ? { id: c.assignee.slackUserId, url: project.boardShareId ? `${origin}/b/${project.boardShareId}` : `${origin}/dashboard/boards/${project.id}` } : null,
      c.reporter?.slackUserId ? { id: c.reporter.slackUserId, url: `${origin}/dashboard/boards/${project.id}` } : null,
    ].filter((t): t is { id: string; url: string } => !!t);
    if (!targets.length) { skipped.push(`${c.title}: nobody on the card has a Slack id`); continue; }
    let delivered = 0;
    for (const t of targets) {
      const r = await postSlack(`<@${t.id}> *${escapeSlack(c.title)}* (${escapeSlack(project.name)}) is due ${when.slice(0, 16).replace("T", " ")} UTC — <${t.url}|Open card>`);
      if (r.sent) delivered++; else skipped.push(`${c.title} → <@${t.id}>: ${r.reason}`);
    }
    if (delivered) {
      await db.issue.update({ where: { id: c.id }, data: { dueRemindedAt: now } });
      sent += delivered;
    }
  }
  return NextResponse.json({ at: now.toISOString(), inWindow: due.length, sent, skipped });
}
