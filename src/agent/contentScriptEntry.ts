import { initContentScript } from "./contentScript.js";

const frameScope = window as Window & { __talk2tabContentScriptInitialized?: boolean };
if (!frameScope.__talk2tabContentScriptInitialized) {
  frameScope.__talk2tabContentScriptInitialized = true;
  initContentScript(chrome, document, window);
}
