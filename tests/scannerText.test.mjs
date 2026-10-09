import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { summarizePageText } = await import("../dist/agent/scanner/text.js");

test("page text summary samples semantic regions beyond the beginning of a long page", () => {
  const longHeading = "Header information ".repeat(80);
  const dom = new JSDOM(`<header><h1>${longHeading}</h1></header><main><section><h2>Latest products</h2><article><a href="/item">Distinctive item lower on page</a></article></section></main>`, { pretendToBeVisual: true });
  const summary = summarizePageText(dom.window.document);
  assert.ok(summary.includes("Latest products"));
  assert.ok(summary.includes("Distinctive item lower on page"));
});

test("debug overlay text is excluded from the page summary", () => {
  const dom = new JSDOM(`<main>Real page content</main><div id="voice-browser-agent-debug-overlay">ephemeral reference el_1_3</div>`);
  const summary = summarizePageText(dom.window.document);
  assert.ok(summary.includes("Real page content"));
  assert.equal(summary.includes("ephemeral reference"), false);
});
