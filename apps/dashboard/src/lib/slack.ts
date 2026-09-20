import "server-only";

// One incoming webhook, the same mechanism LinkSpy's five notifiers use. It
// posts to whichever channel the webhook was created for; a `<@U…>` in the
// text is what turns a channel post into a ping for one person.
//
// Never throws. The caller records the outcome (IssueMention.notifiedAt), so
// an unset URL or a failed POST is visible in the data, not swallowed.

export async function postSlack(text: string): Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "SLACK_WEBHOOK_URL is not set" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `Slack answered ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Slack unreachable" };
  }
}
