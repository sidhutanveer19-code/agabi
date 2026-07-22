/**
 * Extraction prompts (§12.4). Advisor-side — imports nothing but its own strings, so it
 * stays within the advisor wall (W1). `PROMPT_VERSION` is stamped into every Provenance
 * row (§10) so a future replay knows exactly which prompt produced a statement; bump it on
 * any wording change or the golden-set comparison becomes apples-to-oranges.
 *
 * Two rules the prompts must enforce, because the validators depend on them:
 *  · Quotes are copied EXACTLY from the source (ADR-3 / V3) — paraphrase fails grounding.
 *  · `text` is WRITTEN in the model's own words, never the source's (§27.1 / V5 copyright).
 * The model is NEVER asked for a trust/confidence field — trust is the platform's to assign.
 */
export const PROMPT_VERSION = "knowledge-extract@1";

const COMMON = `You extract structured knowledge from a source passage. Rules:
- Output ONLY valid JSON in the requested shape. No prose, no markdown.
- Every "quote" MUST be copied CHARACTER-FOR-CHARACTER from the passage. Never paraphrase a quote.
- Every "text" MUST be written in your OWN words — never copy the source into "text".
- Do NOT invent a confidence, trust, or verified field. You propose; you do not judge.`;

export function entitiesPrompt(chunkText: string): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: list the distinct CONCEPTS (entities/skills) the passage is about.
Shape: { "entities": [ { "name": string, "aliases"?: string[], "kind"?: "ENTITY"|"SKILL" } ] }`,
    user: chunkText,
  };
}

export function statementsPrompt(chunkText: string, entityNames: string[]): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: extract the ASSERTIONS the passage makes, each grounded in an exact quote.
Known concepts: ${entityNames.join(", ") || "(none yet)"}.
Shape: { "statements": [ {
  "form": "SPO"|"DEFINITIONAL"|"CAUSAL"|"CONDITIONAL"|"COMPARATIVE"|"QUANTIFIED"|"PROBABILISTIC",
  "kind": "FACT"|"PROCEDURE"|"PRINCIPLE"|"RULE"|"DEFINITION"|"RELATIONSHIP",
  "text": string, "quote": string,
  "structure": object, "subject"?: string, "predicate"?: string, "object"?: string, "objectLit"?: string
} ] }`,
    user: chunkText,
  };
}

export function assetsPrompt(chunkText: string, entityNames: string[]): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: propose TEACHING assets for the known concepts. Phase 2 accepts THREE kinds only:
- MISCONCEPTION { "misconception": string, "correction": string }
- ANALOGY { "source": string, "mapping": string, "breakdownPoint": string }  ← breakdownPoint is MANDATORY
- WORKED_EXAMPLE { "problem": string, "steps": string[], "answer": string }
Every ANALOGY MUST state where the analogy breaks down, or it installs a misconception.
Known concepts: ${entityNames.join(", ") || "(none yet)"}.
Shape: { "assets": [ { "kind": "MISCONCEPTION"|"ANALOGY"|"WORKED_EXAMPLE", "conceptName": string, "payload": object } ] }`,
    user: chunkText,
  };
}

export function dependenciesPrompt(chunkText: string, entityNames: string[]): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: propose relationships between the known concepts. CLASSIFY each: REQUIRES (must learn A before B),
PART_OF (structural containment), or REINFORCEMENT (mutually strengthening). A human will confirm every classification.
Known concepts: ${entityNames.join(", ") || "(none yet)"}.
Shape: { "dependencies": [ { "fromName": string, "toName": string,
  "classification": "REQUIRES"|"PART_OF"|"REINFORCEMENT", "type"?: string } ] }`,
    user: chunkText,
  };
}
