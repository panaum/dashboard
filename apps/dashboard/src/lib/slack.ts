import "server-only";

// Two ways to reach a person, and they are not equivalent.
//
// A BOT TOKEN (SLACK_BOT_TOKEN, `xoxb-…`) can send a real direct message to
// anyone in the workspace: `chat.postMessage` with the member id as the
// channel. That is what a board @mention should be — personal, and it reaches
// the person wherever they are.
//
// AN INCOMING WEBHOOK (SLACK_WEBHOOK_URL) is permanently bound to the one
// conversation it was created for. A `<@U…>` in the text renders as a
// highlighted name, but if that person is not in that conversation they are
// notified of nothing — and if the webhook belongs to somebody's own DM, only
// that somebody ever sees it. That is a real failure mode we hit: every board
// mention landed in one person's self-DM.
//
// So: DM when we can, webhook when that is all there is, and say which.
// Never throws — the caller records the outcome (IssueMention.notifiedAt), so
// an unset token, a Slack error or a refusal is visible in the data.

import { dmText } from "./board-thread";

export type SlackResult = { sent: boolean; via?: "dm" | "channel"; reason?: string };

// Overridable only so the DM path can be exercised against a stub in tests;
// nothing sets it in production.
const apiBase = () => process.env.SLACK_API_BASE ?? "https://slack.com/api";

/** Direct message one person. `slackUserId` is a member id (U… or W…). */
async function postDirect(slackUserId: string, text: string): Promise<SlackResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { sent: false, reason: "SLACK_BOT_TOKEN is not set" };
  try {
    const res = await fetch(`${apiBase()}/chat.postMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: slackUserId, text: dmText(text), unfurl_links: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { sent: false, reason: `Slack answered ${res.status}` };
    // chat.postMessage answers 200 with {ok:false, error:"…"} on refusal, so
    // the status alone would report a silent failure as a success.
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!body.ok) return { sent: false, reason: `Slack refused: ${body.error ?? "unknown"}` };
    return { sent: true, via: "dm" };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Slack unreachable" };
  }
}

/** Post to the webhook's own conversation. */
async function postWebhook(text: string): Promise<SlackResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "neither SLACK_BOT_TOKEN nor SLACK_WEBHOOK_URL is set" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { sent: true, via: "channel" } : { sent: false, reason: `Slack answered ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Slack unreachable" };
  }
}

/**
 * Reach one person: a direct message when a bot token exists, otherwise the
 * webhook's conversation. A DM failure falls back rather than going silent —
 * except when the token is simply absent, where there is nothing to report.
 */
export async function notifySlack(slackUserId: string, text: string): Promise<SlackResult> {
  if (process.env.SLACK_BOT_TOKEN) {
    const dm = await postDirect(slackUserId, text);
    if (dm.sent) return dm;
    const fallback = await postWebhook(text);
    return fallback.sent
      ? { ...fallback, reason: `DM failed (${dm.reason}) — posted to the webhook channel instead` }
      : { sent: false, reason: `${dm.reason}; webhook also failed (${fallback.reason})` };
  }
  return postWebhook(text);
}

/** For messages addressed to nobody in particular. */
export async function postSlack(text: string): Promise<SlackResult> {
  return postWebhook(text);
}
