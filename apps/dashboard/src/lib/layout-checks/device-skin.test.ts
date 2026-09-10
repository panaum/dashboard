import { test } from "node:test";
import assert from "node:assert/strict";
import { cutoutBox, skinFor } from "@/lib/layout-checks/device-skin";

test("an iPhone is identified by its island and its buttons on both sides", () => {
  const s = skinFor("iphone-16-pro", "phone");
  assert.equal(s.cutout, "island");
  assert.ok(s.buttons.some((b) => b.side === "left"));
  assert.ok(s.buttons.some((b) => b.side === "right"));
});

test("an Android phone puts every button on the right, and has a punch-hole", () => {
  const s = skinFor("galaxy-s25", "phone");
  assert.equal(s.cutout, "hole");
  assert.ok(s.buttons.length > 0);
  assert.ok(s.buttons.every((b) => b.side === "right"));
});

test("the SE is the one with a chin and a home button", () => {
  const s = skinFor("iphone-se-3", "phone");
  assert.equal(s.home, true);
  assert.equal(s.cutout, "earpiece");
  assert.ok(s.bezelBottom > skinFor("iphone-16", "phone").bezelBottom * 3);
});

test("the Ultra is squarer than the S25", () => {
  assert.ok(skinFor("galaxy-s25-ultra", "phone").radius < skinFor("galaxy-s25", "phone").radius);
});

test("an unknown profile falls back to its shape rather than borrowing a body", () => {
  assert.deepEqual(skinFor("pixel-99", "phone"), skinFor(null, "phone"));
  assert.equal(skinFor("pixel-99", "phone").cutout, "none");
  assert.equal(skinFor(undefined, "desktop").bezelX, 0);
});

test("every button sits inside the body", () => {
  for (const id of ["iphone-16", "iphone-se-3", "galaxy-s25", "galaxy-tab-s10-plus", "galaxy-z-flip-cover"]) {
    for (const b of skinFor(id, "phone").buttons) {
      assert.ok(b.top >= 0 && b.top + b.height <= 1, `${id}: ${b.top}+${b.height}`);
    }
  }
});

test("a cutout is never taller than the bezel that holds it", () => {
  for (const id of ["iphone-16", "galaxy-s25", "iphone-se-3"]) {
    const s = skinFor(id, "phone");
    const box = cutoutBox(s, 300);
    assert.ok(box, id);
    assert.ok(box.height <= s.bezelTop - 4, `${id}: ${box.height} vs ${s.bezelTop}`);
    assert.ok(box.width > 0 && box.width < 300);
  }
});

test("nothing is drawn where there is no cutout or no room for one", () => {
  assert.equal(cutoutBox(skinFor("ipad-pro-13", "tablet"), 400), null);
  assert.equal(cutoutBox(skinFor("galaxy-s25", "phone"), 0), null);
});
