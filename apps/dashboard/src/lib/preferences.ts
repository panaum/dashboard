// PREFERENCES — the Slack pings a person has opted into, and their time zone.
//
// Pure: the senders (board-writes.ts for mentions and replies, the reminder
// sweep for due dates) and the Personalization page all read these rules, and
// the tests pin them without a database.

/** Every kind of Slack ping the app sends a person, and the column that
 *  switches it. Adding a sender means adding a kind here, so a new ping can
 *  never go out without a way to turn it off. */
export const NOTIFY_KINDS = [
  { kind: "mentions", column: "notifyMentions", label: "When someone @mentions me", hint: "A board comment that names you." },
  { kind: "replies", column: "notifyReplies", label: "Replies on cards I’m in", hint: "New comments on a card you have commented on or were mentioned in." },
  { kind: "dueReminders", column: "notifyDueReminders", label: "Due-date reminders", hint: "Before a card you are assigned to or reported is due." },
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number]["kind"];
export type NotifyColumn = (typeof NOTIFY_KINDS)[number]["column"];
export type NotifyPrefs = Partial<Record<NotifyColumn, boolean>>;

const COLUMN: Record<NotifyKind, NotifyColumn> = Object.fromEntries(
  NOTIFY_KINDS.map((k) => [k.kind, k.column]),
) as Record<NotifyKind, NotifyColumn>;

/** Whether this person wants this kind of ping. Missing means yes — the
 *  columns default on, and a row read without them must not go silent. */
export function wantsPing(prefs: NotifyPrefs | null | undefined, kind: NotifyKind): boolean {
  return prefs?.[COLUMN[kind]] !== false;
}

/** A real IANA zone this runtime can format in. */
export function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to show a person's dates in: theirs if set and valid, else the
 *  fallback (the browser's on screen, UTC in a server-written message). */
export function zoneFor(preferred: string | null | undefined, fallback?: string): string | undefined {
  return isTimeZone(preferred) ? preferred : fallback;
}
