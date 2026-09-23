import type { ActionResult, AgentAction, PageState } from "./types.js";
import type { ActionVerification } from "./loop.js";

/** Deterministic post-action checks; no model call is needed for verification. */
export function verifyAction(before: PageState, after: PageState, action: AgentAction, result: ActionResult): ActionVerification {
  if (!result.ok) return { ok: false, progressed: false, reason: result.error ?? "A ação falhou." };
  if (action.type === "scroll") {
    if (result.changed) return { ok: true, progressed: true, reason: action.target ? "Contêiner interno atualizado." : "Viewport atualizado." };
    const moved = after.viewport.scrollY !== before.viewport.scrollY;
    return { ok: moved, progressed: moved, reason: moved ? "Viewport atualizado." : "O scroll não alterou o viewport." };
  }
  if (after.url !== before.url || after.title !== before.title || after.fingerprint !== before.fingerprint) {
    return { ok: true, progressed: true, reason: "A página mudou após a ação." };
  }
  return { ok: true, progressed: Boolean(result.changed), reason: result.changed ? "O executor confirmou a alteração." : "Nenhuma alteração observável." };
}
