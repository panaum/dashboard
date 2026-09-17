import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheme, schemeWords } from "./scheme";

test("a run is the scheme its devices were asked for", () => {
  assert.equal(runScheme({ devices: [{ color_scheme: "dark" }, { color_scheme: "dark" }] }), "dark");
  assert.equal(runScheme({ devices: [{ color_scheme: "light" }] }), "light");
});

test("a report from before schemes were recorded is light — that is all there was", () => {
  assert.equal(runScheme({ devices: [{}] }), "light");
  assert.equal(runScheme({ devices: [] }), "light");
  assert.equal(runScheme(null), "light");
  assert.equal(runScheme(undefined), "light");
});

test("only dark is worth a word", () => {
  assert.equal(schemeWords("dark"), "dark mode");
  assert.equal(schemeWords("light"), null);
});
