import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test, { before, after } from "node:test";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = join(root, "tests", "fixtures", "sites");
let context;
let browserServer;
let secondOriginServer;
let browserOrigin;
let frameOrigin;
let userData;

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const file = path === "/" || path === "/navigation.html" ? "navigation.html"
        : path === "/frame.html" ? "frame.html"
        : path === "/hidden-search" ? "hidden-search.html"
        : path === "/result-one" ? "result-one.html"
        : path === "/result-two" ? "result-two.html"
        : undefined;
      if (!file) { response.writeHead(404).end("Not found"); return; }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      const contents = await readFile(join(fixtureRoot, file), "utf8");
      response.end(file === "navigation.html" ? contents.replace("__FRAME_ORIGIN__", frameOrigin) : contents);
    } catch {
      response.writeHead(500).end("Fixture server error");
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return { server, origin: `http://127.0.0.1:${server.address().port}/` };
}

async function pageScan(worker, page) {
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, browserOrigin);
  assert.ok(tabId, "Fixture tab should be visible to the extension worker");
  return worker.evaluate(async ({ tabId: targetTabId, requestId }) => chrome.tabs.sendMessage(targetTabId, { type: "PAGE_SCAN_REQUEST", requestId }), { tabId, requestId: crypto.randomUUID() });
}

async function execute(worker, page, action) {
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, browserOrigin);
  assert.ok(tabId);
  return worker.evaluate(async ({ tabId: targetTabId, action: selectedAction }) => chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_ACTION", actionId: crypto.randomUUID(), action: selectedAction }), { tabId, action });
}

before(async () => {
  const fixtureOrigin = await startFixtureServer();
  browserServer = fixtureOrigin.server;
  browserOrigin = fixtureOrigin.origin;
  const frame = await startFixtureServer();
  secondOriginServer = frame.server;
  frameOrigin = frame.origin;
  userData = await mkdtemp(join(tmpdir(), "talk2tab-e2e-"));
  context = await chromium.launchPersistentContext(userData, {
    headless: false,
    args: [`--disable-extensions-except=${join(root, "dist")}`, `--load-extension=${join(root, "dist")}`],
  });
});

after(async () => {
  await context?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
  for (const server of [browserServer, secondOriginServer]) {
    if (server) await new Promise((done) => server.close(done));
  }
});

async function openFixture(worker) {
  const page = await context.newPage();
  await page.goto(browserOrigin);
  await page.waitForSelector("#query");
  return page;
}

test("extension scans, fills, submits, and opens the intended result", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await openFixture(worker);
  let observation = await pageScan(worker, page);
  assert.equal(observation.ok, true);
  const query = observation.data.elements.find((element) => element.name === "Buscar no catálogo");
  assert.ok(query, "Accessible search field should be present in the scan");
  const typed = await execute(worker, page, { type: "type", target: { ref: query.ref }, text: "teclado sem fio", replace: true });
  assert.equal(typed.ok, true);
  assert.equal(await page.locator("#query").inputValue(), "teclado sem fio");

  observation = await pageScan(worker, page);
  const searchButton = observation.data.elements.find((element) => element.name === "Pesquisar");
  assert.ok(searchButton);
  const submitted = await execute(worker, page, { type: "click", target: { ref: searchButton.ref } });
  assert.equal(submitted.ok, true);
  await page.getByRole("status").waitFor();
  assert.equal(await page.locator("#status").textContent(), "Resultados para teclado sem fio");

  observation = await pageScan(worker, page);
  const result = observation.data.elements.find((element) => element.href?.endsWith("/result-one"));
  assert.ok(result, "The first organic result should be available as a candidate");
  await execute(worker, page, { type: "click", target: { ref: result.ref } });
  await page.waitForURL("**/result-one");
  assert.equal(await page.title(), "Resultado A");
  await page.close();
});

test("extension operates a dialog and scrolls only the selected nested panel", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  let observation = await pageScan(worker, page);
  const opener = observation.data.elements.find((element) => element.name === "Filtros");
  await execute(worker, page, { type: "click", target: { ref: opener.ref } });
  await page.locator("#filters").waitFor({ state: "visible" });

  observation = await pageScan(worker, page);
  const checkbox = observation.data.elements.find((element) => element.name?.includes("Disponível"));
  assert.ok(checkbox);
  await execute(worker, page, { type: "click", target: { ref: checkbox.ref } });
  assert.equal(await page.locator("#available").isChecked(), true);

  observation = await pageScan(worker, page);
  const panel = observation.data.scrollContainers.find((container) => container.label === "Mensagens");
  assert.ok(panel);
  const scrolled = await execute(worker, page, { type: "scroll", direction: "down", amount: 60, target: { ref: panel.ref } });
  assert.equal(scrolled.ok, true);
  assert.equal(await page.locator("#scroll-panel").evaluate((element) => element.scrollTop), 60);
  await page.close();
});

test("fixture harness rejects an intentionally incorrect final oracle", () => {
  const expected = { title: "Resultado A", url: `${browserOrigin}result-one` };
  const wrong = { title: "Resultado B", url: `${browserOrigin}result-two` };
  assert.throws(() => assert.deepEqual(wrong, expected), /Expected values to be strictly deep-equal/);
});

test("semantic fingerprints are stable and clicks report dispatch separately from effect", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const first = await pageScan(worker, page);
  const second = await pageScan(worker, page);
  assert.equal(first.data.fingerprint, second.data.fingerprint, "Ephemeral refs must not alter semantic state identity");
  const before = await page.locator("#status").textContent();
  const noop = second.data.elements.find((element) => element.name === "Controle sem efeito");
  const result = await execute(worker, page, { type: "click", target: { ref: noop.ref } });
  const after = await page.locator("#status").textContent();
  assert.equal(result.dispatched, true);
  assert.equal(result.changed, false, "A dispatched click does not prove an effect");
  assert.equal(after, before, "The fixture confirms that the click produced no observable effect");
  await page.close();
});

test("extension reveals and inspects a collapsed search field", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await context.newPage();
  await page.goto(`${browserOrigin}hidden-search`);
  let observation = await pageScan(worker, page);
  assert.equal(observation.data.elements.some((element) => element.name === "Buscar produtos"), false);
  const reveal = observation.data.elements.find((element) => element.name === "Abrir busca");
  await execute(worker, page, { type: "click", target: { ref: reveal.ref } });
  observation = await pageScan(worker, page);
  assert.ok(observation.data.elements.some((element) => element.name === "Buscar produtos"));
  await page.close();
});

test("extension rejects refs from a previous observation", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const observation = await pageScan(worker, page);
  const oldRef = observation.data.elements.find((element) => element.name === "Pesquisar").ref;
  await pageScan(worker, page);
  const result = await execute(worker, page, { type: "click", target: { ref: oldRef } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STALE_ELEMENT");
  await page.close();
});

test("extension can uncheck a selected checkbox in the active dialog", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  let observation = await pageScan(worker, page);
  const opener = observation.data.elements.find((element) => element.name === "Filtros");
  await execute(worker, page, { type: "click", target: { ref: opener.ref } });
  observation = await pageScan(worker, page);
  const checkbox = observation.data.elements.find((element) => element.name?.includes("Disponível"));
  await execute(worker, page, { type: "click", target: { ref: checkbox.ref } });
  await page.locator("#available").waitFor();
  observation = await pageScan(worker, page);
  const updated = observation.data.elements.find((element) => element.name?.includes("Disponível"));
  await execute(worker, page, { type: "click", target: { ref: updated.ref } });
  assert.equal(await page.locator("#available").isChecked(), false);
  await page.close();
});

test("keyboard Escape dismisses a dialog and Tab advances actual focus", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  let observation = await pageScan(worker, page);
  const opener = observation.data.elements.find((element) => element.name === "Filtros");
  await execute(worker, page, { type: "click", target: { ref: opener.ref } });
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, browserOrigin);
  const key = (name) => worker.evaluate(async ({ tabId: targetTabId, key: keyName }) => chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_ACTION", actionId: crypto.randomUUID(), action: { type: "keypress", key: keyName } }), { tabId, key: name });
  await key("Escape");
  assert.equal(await page.locator("#filters").evaluate((dialog) => dialog.open), false);

  await page.locator("#query").focus();
  await key("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  await page.close();
});

test("keyboard events reach a focused control in an open shadow root", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "shadow-host";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<input aria-label="Campo no shadow"><output></output>`;
    root.querySelector("input").addEventListener("keydown", (event) => { root.querySelector("output").textContent = event.key; });
    document.body.append(host);
  });
  const observation = await pageScan(worker, page);
  const shadowInput = observation.data.elements.find((element) => element.name === "Campo no shadow");
  assert.ok(shadowInput);
  await page.locator("#shadow-host").evaluate((host) => host.shadowRoot.querySelector("input").focus());
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, browserOrigin);
  await worker.evaluate(async ({ tabId: targetTabId }) => chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_ACTION", actionId: crypto.randomUUID(), action: { type: "keypress", key: "x" } }), { tabId });
  assert.equal(await page.locator("#shadow-host").evaluate((host) => host.shadowRoot.querySelector("output").textContent), "x");
  await page.close();
});

test("click executor refuses a target covered by an overlay", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.id = "test-overlay";
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "99999" });
    document.body.append(overlay);
  });
  const observation = await pageScan(worker, page);
  const search = observation.data.elements.find((element) => element.name === "Pesquisar");
  const result = await execute(worker, page, { type: "click", target: { ref: search.ref } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CLICK_OBSCURED");
  await page.close();
});

test("controlled field waits for mask acceptance and reports a reverted value", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  let observation = await pageScan(worker, page);
  const controlled = observation.data.elements.find((element) => element.name === "Campo controlado com máscara");
  const accepted = await execute(worker, page, { type: "type", target: { ref: controlled.ref }, text: "hello", replace: true });
  assert.equal(accepted.ok, true);
  assert.equal(await page.locator("#controlled").inputValue(), "HELLO");

  observation = await pageScan(worker, page);
  const rollback = observation.data.elements.find((element) => element.name === "Campo que rejeita atualização");
  const rejected = await execute(worker, page, { type: "type", target: { ref: rollback.ref }, text: "reject", replace: true });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "INPUT_REVERTED");
  assert.equal(await page.locator("#rollback").inputValue(), "");
  await page.close();
});

test("native date and time inputs keep canonical values in Chromium", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.innerHTML = `<label for="native-date">Data canônica</label><input id="native-date" type="date"><label for="native-time">Hora canônica</label><input id="native-time" type="time"><label for="native-number">Número limitado</label><input id="native-number" type="number" min="1" max="5" step="2">`;
    document.body.append(form);
  });
  const observation = await pageScan(worker, page);
  const date = observation.data.elements.find((element) => element.name === "Data canônica");
  const time = observation.data.elements.find((element) => element.name === "Hora canônica");
  const number = observation.data.elements.find((element) => element.name === "Número limitado");
  assert.equal((await execute(worker, page, { type: "type", target: { ref: date.ref }, text: "2026-10-09" })).ok, true);
  assert.equal((await execute(worker, page, { type: "type", target: { ref: time.ref }, text: "14:30" })).ok, true);
  assert.equal(await page.locator("#native-date").inputValue(), "2026-10-09");
  assert.equal(await page.locator("#native-time").inputValue(), "14:30");
  assert.equal((await execute(worker, page, { type: "type", target: { ref: number.ref }, text: "4" })).code, "INVALID_VALUE");
  await page.close();
});

test("autocomplete selects a portal option and plain editor preserves existing text", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<label for="country">País</label><input id="country" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="portal-options"><div id="portal-options" role="listbox" hidden><div role="option">Canada</div><div role="option">Cameroon</div></div><label for="plain-editor">Editor simples</label><div id="plain-editor" contenteditable="true">nota anterior</div><label for="rich-editor">Editor rico</label><div id="rich-editor" contenteditable="true"><strong>preservar HTML</strong></div>`);
    const input = document.querySelector("#country");
    const list = document.querySelector("#portal-options");
    input.addEventListener("input", () => { list.hidden = false; input.setAttribute("aria-expanded", "true"); });
    list.querySelectorAll("[role=option]").forEach((option) => option.addEventListener("click", () => {
      input.value = option.textContent;
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-expanded", "false");
      list.hidden = true;
    }));
  });
  let observation = await pageScan(worker, page);
  const country = observation.data.elements.find((element) => element.name === "País");
  await execute(worker, page, { type: "type", target: { ref: country.ref }, text: "Canada", replace: true });
  assert.equal(await page.locator("#country").getAttribute("aria-expanded"), "true", "Typing opens suggestions without selecting one");
  assert.equal(await page.locator("#portal-options [role=option][aria-selected=true]").count(), 0);
  observation = await pageScan(worker, page);
  const canada = observation.data.elements.find((element) => element.role === "option" && element.name === "Canada");
  assert.ok(canada, "Portal suggestion should be discoverable");
  await execute(worker, page, { type: "click", target: { ref: canada.ref } });
  assert.equal(await page.locator("#country").inputValue(), "Canada");
  assert.equal(await page.locator("#country").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#portal-options [aria-selected=true]").textContent(), "Canada");

  observation = await pageScan(worker, page);
  const editor = observation.data.elements.find((element) => element.name === "Editor simples");
  const rich = observation.data.elements.find((element) => element.name === "Editor rico");
  assert.equal((await execute(worker, page, { type: "type", target: { ref: editor.ref }, text: " adicionada", replace: false })).ok, true);
  assert.equal(await page.locator("#plain-editor").textContent(), "nota anterior adicionada");
  const richHtml = await page.locator("#rich-editor").innerHTML();
  assert.equal((await execute(worker, page, { type: "type", target: { ref: rich.ref }, text: "destruir" })).code, "UNSUPPORTED_CONTROL");
  assert.equal(await page.locator("#rich-editor").innerHTML(), richHtml);
  await page.close();
});

test("autocomplete scrolls its linked listbox to an offscreen option", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<label for="country-scroll">Country</label><input id="country-scroll" role="combobox" aria-autocomplete="list" aria-controls="country-scroll-list"><div id="country-scroll-list" role="listbox" style="height:40px;overflow-y:auto;width:240px"><div role="option" style="height:40px">Albania</div><div role="option" style="height:40px">Algeria</div><div role="option" style="height:40px">Andorra</div><div role="option" style="height:40px">Canada</div></div>`);
  });
  let observation = await pageScan(worker, page);
  assert.equal(observation.data.elements.some((element) => element.name === "Canada" && element.role === "option"), false);
  const list = observation.data.scrollContainers.find((container) => container.label === "country-scroll-list");
  assert.ok(list);
  await execute(worker, page, { type: "scroll", direction: "down", amount: 120, target: { ref: list.ref } });
  observation = await pageScan(worker, page);
  const canada = observation.data.elements.find((element) => element.name === "Canada" && element.role === "option");
  assert.ok(canada, "The option should appear after scrolling its own listbox");
  await page.close();
});

test("extension submits an empty search without claiming results exist", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const observation = await pageScan(worker, page);
  const search = observation.data.elements.find((element) => element.name === "Pesquisar");
  await execute(worker, page, { type: "click", target: { ref: search.ref } });
  assert.equal(await page.locator("#status").textContent(), "Digite uma pesquisa");
  await page.close();
});

test("extension scrolls the nested panel back to its start", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const observation = await pageScan(worker, page);
  const panel = observation.data.scrollContainers.find((container) => container.label === "Mensagens");
  await execute(worker, page, { type: "scroll", direction: "down", amount: 60, target: { ref: panel.ref } });
  const next = await pageScan(worker, page);
  const updatedPanel = next.data.scrollContainers.find((container) => container.label === "Mensagens");
  const result = await execute(worker, page, { type: "scroll", direction: "up", amount: 60, target: { ref: updatedPanel.ref } });
  assert.equal(result.changed, true);
  assert.equal(await page.locator("#scroll-panel").evaluate((element) => element.scrollTop), 0);
  await page.close();
});

test("extension opens the second result only when its ref is selected", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const observation = await pageScan(worker, page);
  const second = observation.data.elements.find((element) => element.href?.endsWith("/result-two"));
  await execute(worker, page, { type: "click", target: { ref: second.ref } });
  await page.waitForURL("**/result-two");
  assert.equal(await page.title(), "Resultado B");
  await page.close();
});

test("baseline confirms controls inside an uninjected frame are absent from the scan", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const observation = await pageScan(worker, page);
  const frameInput = page.frameLocator("iframe[title='Frame de pesquisa']").locator("#frame-query");
  await frameInput.waitFor();
  assert.equal(observation.data.elements.some((element) => element.name === "Busca no frame"), false);
  await page.close();
});

test("extension can navigate the active tab and observe the destination", async () => {
  const worker = context.serviceWorkers()[0];
  const page = await openFixture(worker);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, browserOrigin);
  assert.ok(tabId);
  await worker.evaluate(async ({ tabId: targetTabId, url }) => chrome.tabs.update(targetTabId, { url }), { tabId, url: `${browserOrigin}result-one` });
  await page.waitForURL("**/result-one");
  assert.equal(await page.title(), "Resultado A");
  await page.close();
});
