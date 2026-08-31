import { test } from "node:test";
import assert from "node:assert/strict";
import { hostOf, tailOf, matchPages, blockers, type PageRow, type SiteRow } from "./link-match";

const page = (o: Partial<PageRow> & { id: string }): PageRow => ({
  name: o.id, url: null, clientName: "Acme", registrySiteId: null, ...o,
});
const site = (o: Partial<SiteRow> & { id: string }): SiteRow => ({ url: null, ...o });

test("hostOf lowercases, drops www., port, path and query", () => {
  assert.equal(hostOf("https://WWW.Example.com:8443/a/b?x=1"), "example.com");
  assert.equal(hostOf("http://foo.co.uk/"), "foo.co.uk");
  // LinkSpy stores bare hosts too — no scheme must still parse.
  assert.equal(hostOf("example.com"), "example.com");
});

test("hostOf returns null for absent or unparseable input", () => {
  for (const v of [null, undefined, "", "   ", "not a url at all"]) {
    assert.equal(hostOf(v as string | null), null, `${JSON.stringify(v)} should be null`);
  }
});

test("tailOf keeps the last two labels, and is a no-op on short hosts", () => {
  assert.equal(tailOf("app.foo.com"), "foo.com");
  assert.equal(tailOf("foo.com"), "foo.com");
  assert.equal(tailOf(null), null);
});

test("one exact host match on an unlinked page is confident", () => {
  const p = page({ id: "p1", url: "https://acme.com/lp" });
  const s = site({ id: "s1", url: "https://www.acme.com" });
  const r = matchPages([p], [s]);
  assert.equal(r.confident.length, 1);
  assert.equal(r.confident[0].page.id, "p1");
  assert.deepEqual(r.confident[0].exact.map((x) => x.id), ["s1"]);
  assert.equal(r.ambiguous.length, 0);
});

test("two sites on the same host are ambiguous, never confident", () => {
  // This is the real shape of the data: LinkSpy registers a site per URL, so
  // duplicates of one host are common and must not be auto-picked.
  const p = page({ id: "p1", url: "https://acme.com/" });
  const r = matchPages([p], [
    site({ id: "s1", url: "https://acme.com" }),
    site({ id: "s2", url: "https://www.acme.com/contact?source=" }),
  ]);
  assert.equal(r.confident.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].exact.length, 2);
});

test("a shared tail is reported as nearby, and is never confident", () => {
  const p = page({ id: "p1", url: "https://pages.acme.com/lp" });
  const r = matchPages([p], [site({ id: "s1", url: "https://acme.com" })]);
  assert.equal(r.confident.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.deepEqual(r.ambiguous[0].nearby.map((x) => x.id), ["s1"]);
  assert.equal(r.ambiguous[0].exact.length, 0);
});

test("a near-miss hostname is NOT a match — fautons.com vs fauton.com", () => {
  // The one link that exists in production joins a page at fautons.com to a
  // LinkSpy site at fauton.com. Different registrable names: this module must
  // not manufacture that pairing.
  const p = page({ id: "p1", url: "https://fautons.com/" });
  const r = matchPages([p], [site({ id: "s1", url: "https://fauton.com" })]);
  assert.equal(r.proposals.length, 0);
  assert.deepEqual(r.unmatched.map((x) => x.id), ["p1"]);
});

test("already-linked pages are never re-proposed", () => {
  const p = page({ id: "p1", url: "https://acme.com", registrySiteId: "s1" });
  const r = matchPages([p], [site({ id: "s1", url: "https://acme.com" })]);
  assert.deepEqual(r.alreadyLinked.map((x) => x.id), ["p1"]);
  assert.equal(r.proposals.length, 0);
});

test("pages without a URL are separated from pages LinkSpy has never seen", () => {
  const r = matchPages(
    [page({ id: "blank" }), page({ id: "unknown", url: "https://nowhere.test/" })],
    [site({ id: "s1", url: "https://acme.com" })],
  );
  assert.deepEqual(r.noUrl.map((x) => x.id), ["blank"]);
  assert.deepEqual(r.unmatched.map((x) => x.id), ["unknown"]);
});

test("sites nothing pointed at are reported as unused", () => {
  const r = matchPages([page({ id: "p1", url: "https://acme.com" })], [
    site({ id: "s1", url: "https://acme.com" }),
    site({ id: "s2", url: "https://example.com" }),
  ]);
  assert.deepEqual(r.unusedSites.map((x) => x.id), ["s2"]);
});

test("sites with an unparseable url are ignored, not crashed on", () => {
  const r = matchPages([page({ id: "p1", url: "https://acme.com" })], [
    site({ id: "bad", url: null }),
    site({ id: "s1", url: "https://acme.com" }),
  ]);
  assert.equal(r.confident.length, 1);
  assert.deepEqual(r.unusedSites.map((x) => x.id), ["bad"]);
});

test("blockers name both LinkSpy-side reasons a link would be inert", () => {
  assert.deepEqual(blockers(site({ id: "s", hasClient: true, monitored: true })), []);
  const both = blockers(site({ id: "s", hasClient: false, monitored: false }));
  assert.equal(both.length, 2);
  assert.match(both[0], /client_id/);
  assert.match(both[1], /monitoring/);
  // Unknown (undefined) is not a blocker — absence of data isn't evidence.
  assert.deepEqual(blockers(site({ id: "s" })), []);
});
