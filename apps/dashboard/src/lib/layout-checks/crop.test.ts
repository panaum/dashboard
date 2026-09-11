import { test } from "node:test";
import assert from "node:assert/strict";
import { boxWithin, cropFor, cropStyle } from "@/lib/layout-checks/crop";

test("the window is centred on the element, with context around it", () => {
  const c = cropFor({ x: 150, y: 1000, width: 100, height: 20 }, 412, 20000, 88, 64);
  assert.ok(c);
  // window: 100 + 40 = 140 wide (the minimum), 140 * 64/88 ≈ 101.8 tall; centred on (200, 1010)
  assert.equal(c.x, 130);
  assert.equal(c.y, 959);
  assert.equal(+c.scale.toFixed(3), +(88 / 140).toFixed(3));
});

test("an element at the top-left edge shows the edge, not blank space", () => {
  const c = cropFor({ x: 4, y: 2, width: 60, height: 14 }, 412, 20000, 88, 64);
  assert.ok(c);
  assert.equal(c.x, 0); assert.equal(c.y, 0);
});

test("a wide element gets a window wide enough to hold it", () => {
  const c = cropFor({ x: 20, y: 500, width: 372, height: 40 }, 412, 20000, 88, 64);
  assert.ok(c);
  assert.equal(c.x, 0);                    // 372 + 40 > 412, so the window is the page width, from the left edge
  assert.equal(+c.scale.toFixed(3), +(88 / 412).toFixed(3));
});

test("nothing to crop below the image we have", () => {
  assert.equal(cropFor({ x: 0, y: 3000, width: 50, height: 50 }, 412, 892, 88, 64), null);
  assert.ok(cropFor({ x: 0, y: 300, width: 50, height: 50 }, 412, 892, 88, 64));
  assert.ok(cropFor({ x: 0, y: 3000, width: 50, height: 50 }, 412, null, 88, 64));   // height unknown: try
});

test("the element's box lands inside its own picture, clipped to the window", () => {
  const box = { x: 150, y: 1000, width: 100, height: 20 };
  const c = cropFor(box, 412, 20000, 88, 64);
  assert.ok(c);
  const r = boxWithin(c, box);
  // centred window of 140 page px at 88/140 scale: the 100px box is 63 thumb px
  // wide, and the 20px of context on its left is 13 of them
  assert.equal(r.width, 63); assert.equal(r.left, 13);
  assert.ok(r.top > 0 && r.top + r.height <= 64);
  const wide = boxWithin({ scale: 0.5, x: 0, y: 0, w: 100, h: 50 }, { x: -20, y: 10, width: 300, height: 10 });
  assert.equal(wide.left, 0); assert.equal(wide.width, 50);            // clipped to the window
});

test("the style paints the window from the same image", () => {
  const st = cropStyle("/api/devicepreview/shot?x=1", { scale: 0.5, x: 100, y: 2000, w: 176, h: 128 }, 412);
  assert.equal(st.backgroundImage, 'url("/api/devicepreview/shot?x=1")');
  assert.equal(st.backgroundSize, "206px auto");
  assert.equal(st.backgroundPosition, "-50px -1000px");
});
