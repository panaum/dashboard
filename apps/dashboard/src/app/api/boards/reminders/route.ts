import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { dueLabel, remindersDue } from "@/lib/board-dates";
import { wantsPing, zoneFor } from "@/lib/preferences";
import { escapeSlack } from "@/lib/board-thread";
import { notifySlack } from "@/lib/slack";

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
      assignee: { select: { name: true, slackUserId: true, role: true, notifyDueReminders: true, timeZone: true } },
      reporter: { select: { name: true, slackUserId: true, notifyDueReminders: true, timeZone: true } },
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
    const people = [
      c.assignee?.slackUserId ? { ...c.assignee, slackUserId: c.assignee.slackUserId, url: project.boardShareId ? `${origin}/b/${project.boardShareId}` : `${origin}/dashboard/boards/${project.id}` } : null,
      c.reporter?.slackUserId ? { ...c.reporter, slackUserId: c.reporter.slackUserId, url: `${origin}/dashboard/boards/${project.id}` } : null,
    ].filter((t): t is NonNullable<typeof t> => !!t);
    if (!people.length) { skipped.push(`${c.title}: nobody on the card has a Slack id`); continue; }
    // Each person's own switch. If everyone turned due reminders off there is
    // nothing left to retry, so the card counts as reminded.
    const targets = people.filter((p) => wantsPing(p, "dueReminders"));
    for (const p of people) if (!targets.includes(p)) skipped.push(`${c.title} → ${p.name}: due reminders turned off`);
    if (!targets.length) { await db.issue.update({ where: { id: c.id }, data: { dueRemindedAt: now } }); continue; }
    let delivered = 0;
    for (const t of targets) {
      // The due time in the reader's own zone when they set one; UTC otherwise.
      const zone = zoneFor(t.timeZone, "UTC")!;
      const when = `${dueLabel(c.dueAt!, zone)} (${zone === "UTC" ? "UTC" : zone})`;
      const r = await notifySlack(t.slackUserId, `<@${t.slackUserId}> *${escapeSlack(c.title)}* (${escapeSlack(project.name)}) is due ${when} — <${t.url}|Open card>`);
      if (r.sent) { delivered++; if (r.reason) skipped.push(`${c.title} → <@${t.slackUserId}>: ${r.reason}`); }
      else skipped.push(`${c.title} → <@${t.slackUserId}>: ${r.reason}`);
    }
    if (delivered) {
      await db.issue.update({ where: { id: c.id }, data: { dueRemindedAt: now } });
      sent += delivered;
    }
  }
  return NextResponse.json({ at: now.toISOString(), inWindow: due.length, sent, skipped });
}
