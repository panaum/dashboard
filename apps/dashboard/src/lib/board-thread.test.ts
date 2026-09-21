import test from "node:test";
import assert from "node:assert/strict";

import {
  activityFeed, conversationMembers, coverOf, dmText, eventLine, mentionMessage, formatStamp, formatWhen, initials, mentionLabelsFor, parseMentions, participantsFor, plainText, renderComment, slackMentionText,
} from "./board-thread";

const card = { reporterId: "qa-1", reporterName: "Anaum", assigneeId: "dev-1", assigneeName: "Priya Sharma" };

// ── who may be mentioned ────────────────────────────────────────────────────

test("QA may mention the assignee and the reporter, by name", () => {
  assert.deepEqual(participantsFor("qa", card), [
    { id: "dev-1", label: "Priya Sharma" }, { id: "qa-1", label: "Anaum" },
  ]);
});

test("the developer may mention the reporter only, and only as QA", () => {
  // The reporter's name never leaves the server for this view; the id still resolves.
  assert.deepEqual(participantsFor("developer", card), [{ id: "qa-1", label: "QA" }]);
  // A card from the shared session has no reporter: nobody to ping.
  assert.deepEqual(participantsFor("developer", { ...card, reporterId: null, reporterName: null }), []);
});

test("nobody appears twice, and an unassigned card offers only the reporter", () => {
  assert.deepEqual(participantsFor("qa", { ...card, assigneeId: "qa-1", assigneeName: "Anaum" }), [{ id: "qa-1", label: "Anaum" }]);
  assert.deepEqual(participantsFor("qa", { ...card, assigneeId: null, assigneeName: null }), [{ id: "qa-1", label: "Anaum" }]);
});

// ── what a body mentions ────────────────────────────────────────────────────

test("mentions resolve to participant ids, in order, case-insensitively, once each", () => {
  const ps = participantsFor("qa", card);
  assert.deepEqual(parseMentions("@anaum can you check? @Priya Sharma fixed it, @Anaum", ps), ["qa-1", "dev-1"]);
});

test("a longer label wins, a word boundary is required, and strangers are text", () => {
  const ps = [{ id: "a", label: "Priya" }, { id: "b", label: "Priya Sharma" }];
  assert.deepEqual(parseMentions("@Priya Sharma please", ps), ["b"]);
  assert.deepEqual(parseMentions("@Priya please", ps), ["a"]);
  assert.deepEqual(parseMentions("@Priyanka please", ps), []);
  // Whoever the client claims to mention, only the card's participants resolve.
  assert.deepEqual(parseMentions("@ceo @everyone", ps), []);
});

// ── the feed ────────────────────────────────────────────────────────────────

test("comments and stage events interleave by time; a move precedes a comment at the same instant", () => {
  const feed = activityFeed(
    [{ id: "c1", body: "Still broken", authorName: "Anaum", createdAt: "2026-09-12T09:34:00.000Z" }],
    [
      { id: "e1", actorName: "Anaum", fromStage: null, toStage: "NEW", createdAt: "2026-09-12T09:00:00.000Z" },
      { id: "e2", actorName: "Priya", fromStage: "ACTIVE", toStage: "COMPLETED", createdAt: "2026-09-12T09:34:00.000Z" },
    ],
  );
  assert.deepEqual(feed.map((i) => i.id), ["e1", "e2", "c1"]);
  assert.equal(feed[0].kind, "event");
  assert.equal((feed[1] as { text: string }).text, "Priya moved this card from Active to Completed");
  assert.equal((feed[0] as { text: string }).text, "Anaum added this card to New");
});

test("an event with no actor still reads as a sentence", () => {
  assert.equal(eventLine({ actorName: null, fromStage: "COMPLETED", toStage: "ACTIVE" }), "Someone moved this card from Completed to Active");
});

// ── cover, initials, time, Slack ────────────────────────────────────────────

test("the cover is the flagged image; none flagged means no banner", () => {
  assert.equal(coverOf([{ id: 1, isCover: false, bytes: 9 }]), null);
  assert.equal(coverOf([{ id: 1, isCover: true, bytes: 9 }, { id: 2, isCover: true, bytes: 90 }])?.id, 2);
});

test("initials", () => {
  assert.equal(initials("Priya Sharma"), "PS");
  assert.equal(initials("Priya"), "P");
  assert.equal(initials("  Anaum  Q  Test "), "AT");
  assert.equal(initials(""), "?");
});

test("formatWhen reads like a person wrote it, in the given zone", () => {
  assert.equal(formatWhen("2026-09-12T15:04:00.000Z", "UTC"), "12 Sep, 3:04pm");
  assert.equal(formatWhen("2026-09-12T15:04:00.000Z", "Asia/Kolkata"), "12 Sep, 8:34pm");
});

test("the Slack line pings by id, escapes markup, and truncates long bodies", () => {
  const t = slackMentionText({
    slackUserId: "U0AB", byName: "Anaum <QA>", cardTitle: "A & B", boardName: "LP", body: "x".repeat(200), url: "https://d.example/b/t",
  });
  assert.ok(t.startsWith("<@U0AB> *Anaum &lt;QA&gt;* mentioned you on *A &amp; B* (LP): \"" + "x".repeat(139) + "…\""));
  assert.ok(t.endsWith("<https://d.example/b/t|Open card>"));
});

test("the composer never offers the viewer their own name; the shared session sees everyone", () => {
  assert.deepEqual(mentionLabelsFor("qa", card, "qa-1"), ["Priya Sharma"]);
  assert.deepEqual(mentionLabelsFor("qa", card, "dev-1"), ["Anaum"]);
  assert.deepEqual(mentionLabelsFor("qa", card, "bootstrap"), ["Priya Sharma", "Anaum"]);
  assert.deepEqual(mentionLabelsFor("developer", card, "dev-1"), ["QA"]);
});

test("formatStamp writes the date the reference does: day, month, year, 24-hour time", () => {
  assert.equal(formatStamp("2026-08-27T18:45:00.000Z", "Asia/Kolkata"), "28 Aug 2026, 00:15");
  assert.equal(formatStamp("2026-09-12T15:04:00.000Z", "UTC"), "12 Sep 2026, 15:04");
});


// ── comment markup ──────────────────────────────────────────────────────────

const src = (id: string) => `/img?id=${id}`;

test("comment markup: bold, italic, strike, code, lists, links, mention chips, attached images", () => {
  const html = renderComment("**Fixed** the _label_ ~~twice~~ `aria-label`\n- one\n- two\n1. first\nsee https://x.test/p?a=1. @Priya ok\n![shot.png](img:abc_1)", src, ["Priya"]);
  assert.ok(html.includes("<strong>Fixed</strong>"));
  assert.ok(html.includes("<em>label</em>") && html.includes("<s>twice</s>") && html.includes("<code"));
  assert.ok(html.includes('<ul class="my-1 list-disc pl-5"><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('<ol class="my-1 list-decimal pl-5"><li>first</li></ol>'));
  assert.ok(html.includes('href="https://x.test/p?a=1"'), "trailing full stop stays outside the link");
  assert.ok(html.includes('>@Priya</span>'));
  assert.ok(html.includes('src="/img?id=abc_1"') && html.includes('alt="shot.png"'));
});

test("comment markup never lets typed HTML through", () => {
  const html = renderComment('<img src=x onerror=alert(1)> **b** <script>x</script>', src);
  assert.ok(!html.includes("<img src=x") && !html.includes("<script"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("<strong>b</strong>"));
});

test("an underscore inside a word is not italics", () => {
  assert.ok(!renderComment("snake_case_name", src).includes("<em>"));
});

// ── who hears a reply ───────────────────────────────────────────────────────

test("a comment pings everyone already in the conversation, never the speaker", () => {
  const prior = [
    { authorId: "qa-1", mentionedIds: ["dev-1"] },   // QA tagged the developer
    { authorId: "dev-1", mentionedIds: [] },          // the developer answered without a tag
    { authorId: null, mentionedIds: [] },             // shared session, nobody to ping
  ];
  assert.deepEqual(conversationMembers(prior, "dev-1").sort(), ["qa-1"]);
  assert.deepEqual(conversationMembers(prior, "qa-1").sort(), ["dev-1"]);
  assert.deepEqual(conversationMembers([], "qa-1"), []);
});

test("plainText strips markup for the Slack excerpt", () => {
  assert.equal(plainText("**Fixed** the _label_\n- one\n\n![shot.png](img:abc)"), "Fixed the label\n• one\n[image]");
});

// ── a DM does not need to address its own recipient ─────────────────────────

test("dmText drops a leading mention, and touches nothing else", () => {
  assert.equal(
    dmText("<@U0A0PMUE9RQ> *Anaum* mentioned you on *image.png* — <https://x|Open card>"),
    "*Anaum* mentioned you on *image.png* — <https://x|Open card>",
  );
  assert.equal(dmText("<@WABC123> due today"), "due today");
  assert.equal(dmText("*Anaum* replied on *card*"), "*Anaum* replied on *card*");
  // A mention inside the sentence is part of the message, not an address.
  assert.equal(dmText("ping <@U123456> about this"), "ping <@U123456> about this");
  // A channel reference is not a member id.
  assert.equal(dmText("<#C123456> has it"), "<#C123456> has it");
});

// ── Slack Block Kit ─────────────────────────────────────────────────────────

const msgInput = {
  kind: "mention" as const,
  slackUserId: "U0DEV",
  byName: "Anaum",
  cardTitle: "image.png",
  boardName: "24 Hours AR Hubspot LP",
  body: "@Tajamul Hi",
  url: "https://d.example/b/tok",
};

test("a mention renders as the five blocks the notification needs", () => {
  const m = mentionMessage(msgInput);
  assert.deepEqual(m.blocks!.map((b) => b.type), ["section", "context", "section", "divider", "actions"]);
  assert.equal((m.blocks![0] as any).text.text, "💬 *You were mentioned on a card*");
  assert.equal((m.blocks![1] as any).elements[0].text, "Anaum · 24 Hours AR Hubspot LP · image.png");
  assert.equal((m.blocks![2] as any).text.text, "> @Tajamul Hi");
  const button = (m.blocks![4] as any).elements[0];
  assert.equal(button.type, "button");
  assert.equal(button.text.text, "Open card →");
  assert.equal(button.url, "https://d.example/b/tok");
  assert.equal(button.style, "primary");
  // Read-only: a link button, never an action_id that posts back.
  assert.ok(!("action_id" in button));
});

test("a reply says so, and keeps the same shape", () => {
  const m = mentionMessage({ ...msgInput, kind: "reply", body: "fixed it" });
  assert.equal((m.blocks![0] as any).text.text, "↩️ *New reply on a card*");
  assert.match(m.text, /replied on \*image\.png\*/);
});

test("the cover becomes an accessory, and no cover means no block at all", () => {
  const withCover = mentionMessage({ ...msgInput, coverUrl: "https://d.example/api/board-image?id=i1&share=tok" });
  const accessory = (withCover.blocks![0] as any).accessory;
  assert.equal(accessory.type, "image");
  assert.equal(accessory.image_url, "https://d.example/api/board-image?id=i1&share=tok");
  assert.equal(accessory.alt_text, "Cover of image.png");
  // Absent, not a placeholder.
  assert.ok(!("accessory" in (mentionMessage(msgInput).blocks![0] as any)));
  assert.ok(!("accessory" in (mentionMessage({ ...msgInput, coverUrl: null }).blocks![0] as any)));
});

test("every line of a multi-line comment is quoted, and the text is escaped", () => {
  const m = mentionMessage({ ...msgInput, body: "line one\nline <two>\nline & three" });
  assert.equal((m.blocks![2] as any).text.text, "> line one\n> line &lt;two&gt;\n> line &amp; three");
});

test("a very long comment is cut in the block and in the preview", () => {
  const m = mentionMessage({ ...msgInput, body: "x".repeat(2000) });
  const quoted = (m.blocks![2] as any).text.text as string;
  assert.ok(quoted.length < 1100 && quoted.endsWith("…"));
  assert.ok(m.text.includes(`${"x".repeat(139)}…`));
});

test("the fallback text keeps the leading mention — a channel post needs it to notify", () => {
  const m = mentionMessage(msgInput);
  assert.ok(m.text.startsWith("<@U0DEV> *Anaum* mentioned you on *image.png*"));
  // …and the DM drops it, because there the recipient is the conversation.
  assert.ok(dmText(m.text).startsWith("*Anaum* mentioned you on"));
});
