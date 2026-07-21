import { generateText } from "ai";
import { z } from "zod";
import { advise, type Advice } from "@/server/advisors/advice";
import { providerChain } from "@/server/advisors/providers";
import { ollamaJSON } from "@/server/advisors/jsonFill";

/** The closed intent enum (a boundary type — conversation imports it and switches on it). */
export const IntentSchema = z.enum([
  "topic", "followup", "continue", "switch_topic",
  "clarification", "greeting", "smalltalk", "pause", "unclear",
]);
export type Intent = z.infer<typeof IntentSchema>;

/** What the advisor proposes: an intent label + (for switch_topic) a target subject.
 *  Conversation validates this via accept() — a bad label collapses to `unclear`. */
export const IntentAdviceSchema = z.object({ intent: IntentSchema, target: z.string().optional() });
export type IntentAdvice = z.infer<typeof IntentAdviceSchema>;

const SYSTEM =
  "You classify a student's message to a learning app into ONE label. Labels: " +
  "topic (wants to learn a subject), followup (a question about what's on screen), " +
  "continue (wants the next part), switch_topic (e.g. 'continue quadratics'), " +
  "clarification (didn't understand / wants it simpler), greeting, smalltalk, pause, unclear. " +
  'Reply with ONLY JSON: {"intent":"<label>","target":"<subject, only for switch_topic, else empty>"}. No prose.';

/**
 * ONE cheap model call, one label back. Untrusted — returns `Advice`, never a
 * decision. Any failure yields `{intent:"unclear"}` (also untrusted). Iterates the
 * provider chain so a dead/rate-limited first provider doesn't sink classification.
 */
export async function classifyIntent(text: string): Promise<Advice<IntentAdvice>> {
  const chain = providerChain();
  for (const p of chain) {
    try {
      let raw: string;
      if (p.ollama) {
        const r = await ollamaJSON(p.ollama.nativeBase, p.ollama.modelId, SYSTEM, text, AbortSignal.timeout(15_000));
        raw = r.raw;
      } else {
        const r = await generateText({ model: p.model, system: SYSTEM, prompt: text, maxRetries: 0, abortSignal: AbortSignal.timeout(15_000) });
        raw = r.text;
      }
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) return advise<IntentAdvice>(JSON.parse(m[0]));
    } catch {
      /* try the next provider */
    }
  }
  return advise<IntentAdvice>({ intent: "unclear" });
}
