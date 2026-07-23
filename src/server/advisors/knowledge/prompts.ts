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
// @2: exclusion rule + few-shot for entities (2a); exhaustiveness + mandatory subject naming for
// statements (2d). Bumped because provenance records it and the golden-set comparison depends on it.
export const PROMPT_VERSION = "knowledge-extract@2";

const COMMON = `You extract structured knowledge from a source passage. Rules:
- Output ONLY valid JSON in the requested shape. No prose, no markdown.
- Every "quote" MUST be copied CHARACTER-FOR-CHARACTER from the passage. Never paraphrase a quote.
- Every "text" MUST be written in your OWN words — never copy the source into "text".
- Do NOT invent a confidence, trust, or verified field. You propose; you do not judge.`;

/**
 * Pass 1 — entities (2a). The exclusion rule and the few-shot pair exist because no validator can
 * catch this class of error: "Qutub Minar" extracted from a height-of-a-tower exercise is a
 * perfectly well-formed RawEntity, so it becomes a DRAFT concept and pollutes the graph. It is a
 * prompt gap and has to be fixed here. Few-shot carries most of the weight for a 7B local model on
 * a judgement call — a bare instruction under-constrains it.
 */
export function entitiesPrompt(chunkText: string): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: list the distinct teachable CONCEPTS (entities/skills) the passage is ABOUT.

INCLUDE: ideas a student must learn — theorems, definitions, methods, quantities, phenomena, skills.
EXCLUDE, always:
- props and settings invented for an example or exercise (a tower, a building, a person's name, a city, a price, a date)
- worked-example specifics (the particular numbers, the particular triangle)
- section headings, figure/table captions, exercise numbers
Ask of each candidate: "would this appear in a syllabus?" If no, leave it out.

Example passage: "A boy standing 15 m from the Qutub Minar observes its top at 60°. Use the tangent
ratio to find the height."
CORRECT: ["tangent ratio", "angle of elevation", "height and distance problems"]
WRONG:   ["Qutub Minar", "boy", "15 m", "60 degrees"]   ← props, not concepts

Shape: { "entities": [ { "name": string, "aliases"?: string[], "kind"?: "ENTITY"|"SKILL" } ] }`,
    user: chunkText,
  };
}

/**
 * Pass 2 — statements (2d). Two additions over @1, both driven by measurement:
 *  · EXHAUSTIVENESS. @1 gave a shape but never asked for completeness, and yielded 2.5 proposals
 *    per chunk (18 per chapter against M3's ~400) while the far more concrete assets and items
 *    prompts yielded normally on the same chunks.
 *  · MANDATORY "subject". Every form must name the concept it is about, because that name is what
 *    resolves to `subjectId` (A-5) — a statement without it is reachable from no concept.
 */
export function statementsPrompt(chunkText: string, entityNames: string[]): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: extract EVERY assertion the passage makes, each grounded in an exact quote.

Be exhaustive. A textbook paragraph usually carries several assertions — a definition, a property,
a condition, a consequence. Extract each one separately rather than merging them. A typical passage
of this size yields 10-25 statements; returning two or three means you stopped early.

Every statement MUST name the concept it is about in "subject" — for EVERY form, not only SPO.
Use a name from the known-concepts list when one fits. A statement with no subject is discarded.

Do NOT extract: exercise instructions, figure captions, or the arithmetic of a worked example.
DO extract the rule or property the worked example demonstrates.

Known concepts: ${entityNames.join(", ") || "(none yet)"}.

Example passage: "The Fundamental Theorem of Arithmetic states that every composite number can be
factorised as a product of primes, and this factorisation is unique apart from the order."
CORRECT (two separate statements, both with a subject):
  { "form": "DEFINITIONAL", "kind": "DEFINITION", "subject": "Fundamental Theorem of Arithmetic",
    "predicate": "states", "text": "Every composite number breaks down into primes.",
    "quote": "every composite number can be factorised as a product of primes", "structure": {} }
  { "form": "QUANTIFIED", "kind": "PRINCIPLE", "subject": "prime factorisation",
    "predicate": "is unique", "text": "That breakdown is the only one, ignoring order.",
    "quote": "this factorisation is unique apart from the order", "structure": {} }

Shape: { "statements": [ {
  "form": "SPO"|"DEFINITIONAL"|"CAUSAL"|"CONDITIONAL"|"COMPARATIVE"|"QUANTIFIED"|"PROBABILISTIC",
  "kind": "FACT"|"PROCEDURE"|"PRINCIPLE"|"RULE"|"DEFINITION"|"RELATIONSHIP",
  "text": string, "quote": string,
  "structure": object, "subject": string, "predicate"?: string, "object"?: string, "objectLit"?: string
} ] }`,
    user: chunkText,
  };
}

export function itemsPrompt(chunkText: string, entityNames: string[]): { system: string; user: string } {
  return {
    system: `${COMMON}
Task: propose ASSESSMENT items testing the known concepts. Kinds: MCQ, SHORT, NUMERIC.
For MCQ, EVERY wrong option (distractor) SHOULD name the misconception it diagnoses.
Known concepts: ${entityNames.join(", ") || "(none yet)"}.
Shape: { "items": [ { "kind": "MCQ"|"SHORT"|"NUMERIC", "conceptName": string, "prompt": string,
  "payload": object } ] }
MCQ payload: { "options": [ { "text": string, "correct": boolean, "diagnosesMisconception"?: string } ] }`,
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
