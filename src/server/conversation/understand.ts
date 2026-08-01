import type { Intent } from "@/server/advisors/intent";

/**
 * The Intent Object — a PURE, structured view of an already-validated intent label (from
 * classifyIntent + accept()). No model, no I/O here: the one model call stays in the advisor,
 * and this turns its untrusted label into the typed fields the Capability Router decides on.
 *
 * L3 (measure the decision, not the prediction): the router acts on `requiresCorpus` + `topic`,
 * not on the model's free text — so the thing we measure (did it teach the right thing?) is a
 * function of these fields, which are deterministic given the label.
 */
export interface IntentObject {
  intent: Intent;
  target?: string;
  topic: string | null; // the subject to teach/resume, if any
  confidence: "high" | "low"; // low ONLY for `unclear` — drives clarify, never a lesson
  requiresCorpus: boolean; // true ONLY for a NEW lesson (`topic`) — it must be grounded in the book
}

/** PURE. Given the validated intent (+ target for switch_topic) and the message, structure it. */
export function understandIntent(intent: Intent, text: string, target?: string): IntentObject {
  const topic =
    intent === "topic" ? text.trim() : intent === "switch_topic" ? (target ?? null) : null;
  return {
    intent,
    target,
    topic,
    confidence: intent === "unclear" ? "low" : "high",
    requiresCorpus: intent === "topic",
  };
}
