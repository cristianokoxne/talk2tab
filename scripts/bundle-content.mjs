import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  bundle: true,
  entryPoints: [resolve(root, "src/agent/contentScriptEntry.ts")],
  format: "iife",
  outfile: resolve(root, "dist/contentScript.js"),
  platform: "browser",
  target: "chrome120",
});
