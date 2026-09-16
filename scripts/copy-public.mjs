import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public");
const destination = join(root, "dist");

await mkdir(destination, { recursive: true });
const files = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "options.html",
  "options.css",
];

await Promise.all(files.map((file) => copyFile(join(source, file), join(destination, file))));
