import { test } from "node:test";
import assert from "node:assert/strict";
import { accessState, tourFor, type RequestRow } from "./onboarding";
import type { Actor, Rank } from "./permissions";

const actor = (rank: Rank): Actor => ({ id: "m1", name: "Test", rank });
const ids = (rank: Rank) => tourFor(actor(rank)).map((s) => s.id);

test("an admin's tour has all six stops, Team included", () => {
  assert.deepEqual(ids("ADMIN"), ["boards", "team", "layout-checks", "insights", "records", "profile"]);
});

test("members and viewers never get a Team stop — they cannot open the page", () => {
  assert.equal(ids("MEMBER").length, 5);
  assert.equal(ids("VIEWER").length, 5);
  assert.ok(!ids("MEMBER").includes("team"));
  assert.ok(!ids("VIEWER").includes("team"));
});

test("the tour stays within six steps for everyone", () => {
  for (const r of ["ADMIN", "MEMBER", "VIEWER"] as const) assert.ok(tourFor(actor(r)).length <= 6);
});

test("a viewer's records stop says they can look, not fill", () => {
  const viewer = tourFor(actor("VIEWER")).find((s) => s.id === "records")!;
  const member = tourFor(actor("MEMBER")).find((s) => s.id === "records")!;
  assert.match(viewer.body, /Member work/);
  assert.doesNotMatch(member.body, /Member work/);
});

test("only a viewer's profile stop mentions asking for access", () => {
  assert.match(tourFor(actor("VIEWER")).at(-1)!.body, /Member access/);
  assert.doesNotMatch(tourFor(actor("MEMBER")).at(-1)!.body, /Member access/);
});

test("no signed-in person, no tour", () => {
  assert.deepEqual(tourFor(null), []);
});

const req = (status: string, extra: Partial<RequestRow> = {}): RequestRow => ({
  id: "r1", fromRank: "VIEWER", toRank: "MEMBER", status, reason: null, reviewNote: null,
  createdAt: "2026-09-24T10:00:00.000Z", reviewedAt: null, ...extra,
});

test("a viewer with no request may ask", () => {
  assert.deepEqual(accessState("VIEWER", null), { kind: "none", canRequest: true });
});

test("members and admins are never offered the request", () => {
  assert.equal(accessState("MEMBER", null).canRequest, false);
  assert.equal(accessState("ADMIN", null).canRequest, false);
});

test("a pending request blocks a second one and shows its status", () => {
  const s = accessState("VIEWER", req("pending"));
  assert.equal(s.kind, "pending");
  assert.equal(s.canRequest, false);
});

test("a denial allows asking again immediately, and carries the note", () => {
  const s = accessState("VIEWER", req("denied", { reviewNote: "Not yet" }));
  assert.equal(s.kind, "denied");
  assert.equal(s.canRequest, true);
  assert.equal(s.kind === "denied" && s.request.reviewNote, "Not yet");
});

test("an approved request shows its outcome and offers nothing once promoted", () => {
  const s = accessState("MEMBER", req("approved"));
  assert.equal(s.kind, "approved");
  assert.equal(s.canRequest, false);
});
