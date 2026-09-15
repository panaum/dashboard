import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFrame3d, resetFrame3dMemory, STORAGE_KEY, writeFrame3d } from "./frame3d";

const fake = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
};
const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

beforeEach(() => resetFrame3dMemory());

test("off by default: nothing stored, no storage, or storage that throws", () => {
  assert.equal(readFrame3d(fake()), false);
  assert.equal(readFrame3d(null), false);
  assert.equal(readFrame3d(broken), false);
});

test("only a stored 'on' is on", () => {
  assert.equal(readFrame3d(fake({ [STORAGE_KEY]: "on" })), true);
  for (const v of ["off", "true", "1", "ON", ""]) assert.equal(readFrame3d(fake({ [STORAGE_KEY]: v })), false, v);
});

test("the choice is remembered in storage", () => {
  const store = fake();
  writeFrame3d(store, true);
  assert.equal(store.data[STORAGE_KEY], "on");
  resetFrame3dMemory();                     // a new page load
  assert.equal(readFrame3d(store), true);
  writeFrame3d(store, false);
  resetFrame3dMemory();
  assert.equal(readFrame3d(store), false);
});

test("where storage refuses, the toggle still works for the visit", () => {
  writeFrame3d(broken, true);
  assert.equal(readFrame3d(broken), true);
  writeFrame3d(broken, false);
  assert.equal(readFrame3d(broken), false);
  resetFrame3dMemory();                     // and is forgotten on the next load
  assert.equal(readFrame3d(broken), false);
});
