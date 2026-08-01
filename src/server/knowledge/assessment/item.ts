import type { AssessmentItem, Scope } from "@/server/knowledge/types";
import type { ValidationResult } from "@/server/knowledge/validators/types";
import { mintId } from "@/server/knowledge/ids";
import { validateItemPayload } from "@/server/knowledge/assessment/registry";

/**
 * Build an assessment item (§10, M9). MACHINE_PROPOSED at construction (ADR-2). The payload is
 * kind-validated (MCQ needs exactly one correct option; distractors may carry
 * diagnosesMisconception). Its outcome, when a learner attempts it, is recorded as an
 * Observation (F5) — which is what makes it evidence rather than practice.
 */
export interface ItemInput {
  kind: string;
  prompt: string;
  payload: Record<string, unknown>;
  contextId: string;
  scope?: Scope;
}

export function buildItem(input: ItemInput): { item: AssessmentItem; validation: ValidationResult } {
  const validation = validateItemPayload(input.kind, input.payload);
  const item: AssessmentItem = {
    id: mintId(),
    kind: input.kind,
    prompt: input.prompt,
    payload: input.payload,
    contextId: input.contextId,
    scope: input.scope ?? "PUBLIC",
    trustLevel: "MACHINE_PROPOSED",
    version: 1,
    supersedes: null,
  };
  return { item, validation };
}

/** The misconception a chosen MCQ distractor diagnoses, if any (§13.2). */
export function diagnosedMisconception(item: AssessmentItem, chosenIndex: number): string | null {
  const options = item.payload.options;
  if (!Array.isArray(options)) return null;
  const opt = options[chosenIndex] as { diagnosesMisconception?: string } | undefined;
  return typeof opt?.diagnosesMisconception === "string" ? opt.diagnosesMisconception : null;
}
