import assert from "node:assert/strict";
import test from "node:test";

const { aggregateFrameObservations, frameScopedRef, parseFrameScopedRef } = await import("../dist/agent/frames.js");

test("frame refs preserve local IDs and route to the correct document", () => {
  const ref = frameScopedRef(7, "el_doc_abc_2_4");
  assert.equal(ref, "fr7__el_doc_abc_2_4");
  assert.deepEqual(parseFrameScopedRef(ref), { frameId: 7, localRef: "el_doc_abc_2_4" });
  assert.equal(parseFrameScopedRef("local_ref"), undefined);
});

test("frame aggregation contextualizes duplicate fields and keeps focus and scroll refs scoped", () => {
  const box = { x: 0, y: 0, width: 200, height: 30 };
  const top = {
    url: "https://shop.test", title: "Shop", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "Parent page", fingerprint: "top", limitations: [],
    elements: [{ ref: "el_top_1_1", frameId: 0, tag: "input", role: "textbox", name: "Email", visible: true, enabled: true, bounds: box }],
    focusedElement: "el_top_1_1", scrollContainers: [{ ref: "el_top_1_2", label: "Parent panel", scrollTop: 0, clientHeight: 100, scrollHeight: 500, bounds: box }],
    embeddedFrames: [{ title: "Payment form", url: "https://pay.test/form", sandboxed: false }],
  };
  const child = {
    ...top, url: "https://pay.test/form", title: "Payment", pageTextSummary: "Cardholder form", fingerprint: "child",
    elements: [{ ref: "el_child_1_1", frameId: 0, tag: "input", role: "textbox", name: "Email", visible: true, enabled: true, bounds: box }],
    focusedElement: "el_child_1_1", scrollContainers: [{ ref: "el_child_1_2", label: "Card panel", scrollTop: 0, clientHeight: 100, scrollHeight: 500, bounds: box }],
  };
  const state = aggregateFrameObservations([
    { frame: { frameId: 0, url: "https://shop.test", title: "Shop", accessible: true }, state: top },
    { frame: { frameId: 3, url: "https://pay.test/form", title: "Payment", accessible: true }, state: child },
  ]);
  assert.deepEqual(state.elements.map((element) => element.ref), ["fr0__el_top_1_1", "fr3__el_child_1_1"]);
  assert.equal(state.elements[1].frameId, 3);
  assert.match(state.elements[1].context, /Payment.*https:\/\/pay\.test/);
  assert.equal(state.focusedElement, "fr0__el_top_1_1", "The top document wins when more than one document reports local focus");
  assert.equal(state.scrollContainers?.[1].ref, "fr3__el_child_1_2");
  assert.match(state.pageTextSummary, /Cardholder form/);
  assert.equal(state.limitations.includes("one_or_more_embedded_frames_unavailable_or_sandboxed"), false);
});

test("missing frames report an uncertain access limitation, not a closed-shadow diagnosis", () => {
  const state = aggregateFrameObservations([
    { frame: { frameId: 0, url: "https://shop.test", title: "Shop", accessible: true }, state: {
      url: "https://shop.test", title: "Shop", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "", fingerprint: "top", limitations: [], elements: [], embeddedFrames: [{ sandboxed: true }],
    } },
  ], 1);
  assert.ok(state.limitations.includes("one_or_more_embedded_frames_unavailable_or_sandboxed"));
  assert.equal(state.limitations.some((entry) => entry.includes("closed_shadow_root_detected")), false);
});
