const defaults = { id: "jev", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest" };
const form = document.querySelector("#jev-form");
const endpoint = document.querySelector("#jev-endpoint");
const model = document.querySelector("#jev-model");
const apiKey = document.querySelector("#jev-api-key");
const status = document.querySelector("#jev-status");

chrome.storage.local.get("jevProvider").then(({ jevProvider }) => {
  const config = { ...defaults, ...(jevProvider || {}) };
  endpoint.value = config.endpoint;
  model.value = config.model;
  apiKey.value = config.apiKey || "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({ jevProvider: { id: "jev", endpoint: endpoint.value.trim(), model: model.value.trim(), apiKey: apiKey.value } });
  status.textContent = "Configuração salva.";
});
