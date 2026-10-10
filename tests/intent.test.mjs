import assert from "node:assert/strict";
import test from "node:test";

const { parseGoal } = await import("../dist/agent/intent.js");
const { buildJevCommandMap } = await import("../dist/agent/provider/commandMap.js");

test("PT-BR search phrasing extracts only the requested term across 40 variations", () => {
  const verbs = ["pesquise por", "pesquise sobre", "buscar por", "busque", "procure por", "procure", "ache", "pesquisar por", "busca por", "faça uma busca por"];
  const queries = ["café especial", "últimos vídeos do Alanzoka", "preço do iPhone 17", "receitas de pão de queijo"];
  let checked = 0;
  for (const verb of verbs) for (const query of queries) {
    const plan = parseGoal(`${verb} “${query}” e abra o primeiro resultado`);
    assert.equal(plan.stages[0]?.kind, "search");
    assert.equal(plan.stages[0]?.value, query);
    assert.equal(plan.stages[1]?.kind, "open_result");
    assert.equal(plan.stages[1]?.value, "first");
    checked += 1;
  }
  assert.equal(checked, 40);
});

test("compound search preserves the original goal and keeps opening results pending", () => {
  const goal = "pesquise por \"teclado mecânico\" e abra o primeiro resultado";
  const page = { url: "https://search.test", title: "Search", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "", fingerprint: "search", limitations: [], elements: [{ ref: "el_1_1", frameId: 0, tag: "input", role: "searchbox", name: "Busca", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 200, height: 30 } }] };
  const initial = buildJevCommandMap(goal, page);
  const typing = initial.options.find((option) => option.action.type === "type");
  assert.equal(typing.action.text, "teclado mecânico");
  assert.equal(initial.map.state.goal, goal);
  assert.deepEqual(initial.map.state.goalPlan.stages.map(({ kind }) => kind), ["search", "open_result"]);
  const resultsPage = { ...page, elements: [{ ref: "el_1_2", frameId: 0, tag: "a", role: "link", name: "Teclado mecânico — loja", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 300, height: 30 } }] };
  const afterSearch = buildJevCommandMap(goal, resultsPage, [], ["type", "keypress"]);
  assert.ok(afterSearch.options.some((option) => option.action.type === "click"));
  assert.equal(afterSearch.options.some((option) => option.action.type === "finish" && option.action.status === "success"), false);
});

test("two labeled form fields receive their own grounded values", () => {
  const goal = "preencha nome: \"Ana Silva\" e email: \"ana@example.com\"";
  const page = { url: "https://form.test", title: "Profile", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "", fingerprint: "form", limitations: [], elements: [
    { ref: "el_1_1", frameId: 0, tag: "input", role: "textbox", name: "Nome", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 200, height: 30 } },
    { ref: "el_1_2", frameId: 0, tag: "input", role: "textbox", name: "E-mail", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 200, height: 30 } },
  ] };
  const { options, map } = buildJevCommandMap(goal, page);
  assert.deepEqual(options.filter((option) => option.action.type === "type").map((option) => option.action.text), ["Ana Silva"]);
  const nextField = buildJevCommandMap(goal, page, [], ["type"], 0, [{ type: "type", targetLabel: "Nome", valueLength: 9, progressed: true }]);
  assert.deepEqual(nextField.options.filter((option) => option.action.type === "type").map((option) => option.action.text), ["ana@example.com"]);
  assert.deepEqual(map.state.goalPlan.stages.filter(({ kind }) => kind === "fill_field").map(({ field, value }) => [field, value]), [["nome", "Ana Silva"], ["email", "ana@example.com"]]);
});

test("negative send constraints block submit options and ambiguous recipients ask a specific question", () => {
  const page = { url: "https://mail.test", title: "Mail", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "", fingerprint: "mail", limitations: [], elements: [
    { ref: "el_1_1", frameId: 0, tag: "button", role: "button", name: "Enviar", visible: true, enabled: true, bounds: { x: 0, y: 0, width: 100, height: 30 } },
    { ref: "el_1_2", frameId: 0, tag: "button", role: "button", name: "Salvar rascunho", visible: true, enabled: true, bounds: { x: 0, y: 40, width: 100, height: 30 } },
  ] };
  const guarded = buildJevCommandMap("Não envie esta mensagem", page);
  assert.ok(guarded.map.state.goalPlan.restrictions.length > 0);
  assert.equal(guarded.options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_1"), false);
  const ambiguous = buildJevCommandMap("Envie esta mensagem para Ana ou Beatriz", page);
  assert.equal(ambiguous.options.length, 1);
  assert.match(ambiguous.options[0].action.message, /qual destinatário/i);
});

test("selection goals cannot finish after typing; they need a matching option selection", () => {
  const goal = "selecione Canada na lista";
  const page = { url: "https://forms.test", title: "Forms", viewport: { width: 800, height: 600, scrollY: 0 }, pageTextSummary: "", fingerprint: "combo", limitations: [], elements: [
    { ref: "el_1_1", frameId: 0, tag: "input", role: "combobox", name: "País", ariaAutocomplete: "list", expanded: true, visible: true, enabled: true, bounds: { x: 0, y: 0, width: 200, height: 30 } },
    { ref: "el_1_2", frameId: 0, tag: "div", role: "option", name: "Canada", selected: false, visible: true, enabled: true, bounds: { x: 0, y: 40, width: 200, height: 30 } },
    { ref: "el_1_3", frameId: 0, tag: "div", role: "option", name: "Cameroon", selected: false, visible: true, enabled: true, bounds: { x: 0, y: 80, width: 200, height: 30 } },
  ] };
  const initial = buildJevCommandMap(goal, page);
  assert.equal(initial.options.some((option) => option.action.type === "finish" && option.action.status === "success"), false);
  assert.ok(initial.options.some((option) => option.action.type === "type" && option.action.text === "Canada"));
  assert.ok(initial.options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_2"));

  const typedOnly = buildJevCommandMap(goal, page, [], ["type"], 0, [{ type: "type", targetLabel: "País", progressed: true }]);
  assert.equal(typedOnly.options.some((option) => option.action.type === "finish" && option.action.status === "success"), false);
  assert.ok(typedOnly.options.some((option) => option.action.type === "click" && option.action.target.ref === "el_1_2"));

  const selected = buildJevCommandMap(goal, page, [], ["type", "click"], 0, [
    { type: "type", targetLabel: "País", progressed: true },
    { type: "click", targetLabel: "Canada", targetRole: "option", progressed: true },
  ]);
  assert.ok(selected.options.some((option) => option.action.type === "finish" && option.action.status === "success"));
});
