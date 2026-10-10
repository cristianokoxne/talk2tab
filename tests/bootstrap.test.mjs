import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestText = await readFile(new URL("../public/manifest.json", import.meta.url), "utf8");
const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ""));

test("uses an MV3 side-panel bootstrap with the required runtime contexts", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.deepEqual(manifest.content_scripts[0].js, ["contentScript.js"]);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_about_blank, true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
  assert.ok(manifest.permissions.includes("sidePanel"));
});
