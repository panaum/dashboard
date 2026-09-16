import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEVICE_MODELS, modelFile, modelFor, modelUrl } from "./models-3d";

test("a device with a model resolves to it; anything else to nothing", () => {
  const s25 = modelFor("galaxy-s25");
  assert.ok(s25);
  assert.equal(modelUrl(s25), "/api/models/galaxy-s25");
  const iphone = modelFor("iphone-16");
  assert.ok(iphone);
  assert.equal(modelUrl(iphone), "/api/models/iphone-16");
  assert.equal(iphone.turn, 180, "this model is exported facing away");
  for (const device of ["ipad-pro-13", "desktop-1440-chrome", "galaxy-s25-ultra", "", null, undefined]) {
    assert.equal(modelFor(device), null, String(device));
  }
});

test("the route's allow-list matches whole names only — a request cannot name a path", () => {
  assert.equal(modelFile("galaxy-s25"), "galaxy-s25");
  assert.equal(modelFile("iphone-16"), "iphone-16");
  for (const bad of ["galaxy-s25.glb", "../galaxy-s25", "../../assets/models/galaxy-s25",
                     "/etc/passwd", "galaxy-s25/../galaxy-s25", "", "GALAXY-S25", "iphone-16.glb"]) {
    assert.equal(modelFile(bad), null, bad);
  }
});

test("every entry names a file that is actually there, and is a plain name", () => {
  for (const m of DEVICE_MODELS) {
    assert.match(m.file, /^[a-z0-9-]+$/, `${m.device}: ${m.file}`);
    assert.ok(existsSync(resolve(process.cwd(), "assets", "models", `${m.file}.glb`)),
              `assets/models/${m.file}.glb is missing`);
  }
});

test("every entry carries its credit and what was stripped — CC BY, and the next reader", () => {
  for (const m of DEVICE_MODELS) {
    for (const [field, value] of Object.entries(m.credit)) {
      assert.ok(value.trim().length > 0, `${m.device}: credit.${field} is empty`);
    }
    assert.match(m.credit.source, /^https:\/\//, m.device);
    assert.match(m.credit.profile, /^https:\/\//, m.device);
    assert.match(m.credit.licence, /CC BY/, `${m.device}: only CC BY models are usable here`);
    assert.ok(m.stripped.trim().length > 0, `${m.device}: say what the optimiser removed`);
  }
});

test("one model per device", () => {
  const devices = DEVICE_MODELS.map((m) => m.device);
  assert.equal(new Set(devices).size, devices.length);
  const files = DEVICE_MODELS.map((m) => m.file);
  assert.equal(new Set(files).size, files.length);
});
