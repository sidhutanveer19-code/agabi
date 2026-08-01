import { pass, type ValidationResult } from "@/server/knowledge/validators/types";

/**
 * Assessment-item registry (§10, C3). Seven kinds. The distinguishing design point:
 * MCQ distractors carry `diagnosesMisconception` — a wrong answer is not noise, it tells the
 * platform WHICH misconception a learner holds (feeding the L4 misconception assets, §13.2).
 *
 * F5 (§13.2): an AssessmentItem is EVIDENCE — its outcome is recorded as an Observation and
 * feeds mastery. An EXERCISE teaching asset is PRACTICE — offered during teaching, never scored.
 * The same prompt may exist as both; the rule is: if the outcome is recorded as evidence, it is
 * an AssessmentItem.
 */
export const ITEM_KINDS = ["MCQ", "SHORT", "NUMERIC", "ORDERING", "MATCHING", "ARTIFACT", "CODE"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function validateItemPayload(kind: string, payload: Record<string, unknown>): ValidationResult {
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
    return { validator: "V2", outcome: "discard", reason: `UNKNOWN_ITEM_KIND_${kind}` };
  }
  if (kind === "MCQ") {
    const options = payload.options;
    if (!Array.isArray(options) || options.length < 2) {
      return { validator: "V2", outcome: "discard", reason: "MCQ_NEEDS_AT_LEAST_TWO_OPTIONS" };
    }
    const correct = options.filter((o) => (o as { correct?: boolean }).correct === true);
    if (correct.length !== 1) {
      return { validator: "V2", outcome: "discard", reason: "MCQ_NEEDS_EXACTLY_ONE_CORRECT" };
    }
    return pass("V2");
  }
  if (kind === "NUMERIC" && typeof payload.answer !== "number") {
    return { validator: "V2", outcome: "discard", reason: "NUMERIC_NEEDS_ANSWER" };
  }
  return pass("V2");
}

/** F5 classification (§13.2): recorded-as-evidence ⇒ AssessmentItem; otherwise a practice Exercise. */
export function classifyByOutcome(recordsEvidence: boolean): "AssessmentItem" | "Exercise" {
  return recordsEvidence ? "AssessmentItem" : "Exercise";
}
