import type { AssetKindDef } from "@/server/knowledge/teaching/registry";
import { pass } from "@/server/knowledge/validators/types";

/**
 * WORKED_EXAMPLE (§13.2) — a fully solved instance the learner can follow step by step.
 * Capability: `demonstrable`. Requires a problem, at least one step, and an answer — a worked
 * example with no steps is just an answer key.
 */
export const workedExampleKind: AssetKindDef = {
  kind: "WORKED_EXAMPLE",
  capabilities: ["demonstrable"],
  requiredPayloadFields: ["problem", "steps", "answer"],
  validate(payload) {
    const problem = typeof payload.problem === "string" && payload.problem.trim().length > 0;
    const answer = typeof payload.answer === "string" && payload.answer.trim().length > 0;
    const steps = Array.isArray(payload.steps) && payload.steps.length > 0;
    if (!problem || !answer || !steps) {
      return { validator: "V2", outcome: "discard", reason: "WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER" };
    }
    return pass("V2");
  },
};
