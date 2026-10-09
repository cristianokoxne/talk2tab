import type { ActionResult, AgentAction, PageState } from "./types.js";
import type { ActionVerification } from "./loop.js";

/** Deterministic post-action checks; no model call is needed for verification. */
export function verifyAction(before: PageState, after: PageState, action: AgentAction, result: ActionResult): ActionVerification {
  if (!result.ok) return { ok: false, progressed: false, effectObserved: false, reason: result.error ?? "A ação falhou." };
  const changedUrl = after.url !== before.url;
  const changedTitle = after.title !== before.title;
  const changedFingerprint = after.fingerprint !== before.fingerprint;
  const changedViewport = after.viewport.scrollY !== before.viewport.scrollY;
  const directlyObservedByExecutor = result.changed === true && (action.type === "type" || action.type === "select" || action.type === "scroll" || action.type === "keypress");
  const effectObserved = changedUrl || changedTitle || changedFingerprint || changedViewport || directlyObservedByExecutor;
  const evidence = [
    ...(changedUrl ? ["url_changed"] : []),
    ...(changedTitle ? ["title_changed"] : []),
    ...(changedFingerprint ? ["semantic_page_state_changed"] : []),
    ...(changedViewport ? ["viewport_scrolled"] : []),
    ...(directlyObservedByExecutor ? ["executor_observed_local_change"] : []),
  ];
  const reason = effectObserved
    ? action.type === "scroll" ? action.target ? "O contêiner interno mudou de posição." : "O viewport mudou de posição."
      : "Foi observada uma mudança de estado após a ação."
    : result.dispatched ? "A ação foi enviada, mas nenhum efeito foi observado."
      : "Nenhuma alteração observável.";
  return { ok: true, progressed: effectObserved, effectObserved, evidence, reason };
}
