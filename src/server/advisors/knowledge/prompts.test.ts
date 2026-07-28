import { describe, it, expect } from "vitest";

import {
  PROMPT_VERSION,
  PARAGRAPH_LABELS,
  classificationPrompt,
  entitiesPrompt,
  statementsPrompt,
  itemsPrompt,
  assetsPrompt,
  dependenciesPrompt,
  type ParagraphLabel,
} from "@/server/advisors/knowledge/prompts";

/**
 * prompts.ts is PURE — every export builds a deterministic string from its args, importing
 * nothing (the advisor wall, W1). There is no I/O edge (no DB/clock/network/fetch), so nothing
 * is mocked: mocking here would only prove the mock. Every assertion pins the EXACT produced
 * text, never "returned something".
 *
 * COMMON is not exported, so it is transcribed here byte-for-byte from the source (em-dash =
 * U+2014, verified) as an INDEPENDENT expected value — the functions must match this literal,
 * not the other way round. Branches under test:
 *   - classificationPrompt.user: paragraphs.map((p,i)=>`[${i}] ${p}`).join("\n\n") for
 *     empty / single / multi (the index-echo + "\n\n" join)
 *   - entitiesPrompt / statementsPrompt hint ternary: `${hint ? `\n${hint}` : ""}` both sides
 *     (default param "" → false branch; explicit hint → true branch)
 *   - `entityNames.join(", ") || "(none yet)"` in statements/items/assets/dependencies:
 *     non-empty → the joined list; empty AND single-empty-string → the "(none yet)" fallback
 *   - the `user` field of each function (chunkText passthrough vs the classification map)
 */

// Transcribed byte-for-byte from prompts.ts lines 16-20. NOT derived from any function's output.
const COMMON = `You extract structured knowledge from a source passage. Rules:
- Output ONLY valid JSON in the requested shape. No prose, no markdown.
- Every "quote" MUST be copied CHARACTER-FOR-CHARACTER from the passage. Never paraphrase a quote.
- Every "text" MUST be written in your OWN words — never copy the source into "text".
- Do NOT invent a confidence, trust, or verified field. You propose; you do not judge.`;

describe("PROMPT_VERSION", () => {
  it("is the exact provenance-stamped version string", () => {
    // Any wording change to a prompt must bump this; it is compared literally against provenance.
    expect(PROMPT_VERSION).toBe("knowledge-extract@2");
  });
});

describe("PARAGRAPH_LABELS", () => {
  it("is exactly the 10 passage kinds, in order", () => {
    expect(PARAGRAPH_LABELS).toEqual([
      "CANONICAL",
      "EXAMPLE",
      "PROBLEM",
      "QUESTION",
      "HISTORY",
      "CONTEXT",
      "MOTIVATION",
      "STORY",
      "PROOF",
      "SUMMARY",
    ]);
    expect(PARAGRAPH_LABELS).toHaveLength(10);
  });

  it("ParagraphLabel is the union of those literals (compile-time), each value assignable", () => {
    // If a label were dropped/renamed this assignment would fail to typecheck (tsc gate).
    const sample: ParagraphLabel = "CANONICAL";
    const proof: ParagraphLabel = "PROOF";
    expect(PARAGRAPH_LABELS.includes(sample)).toBe(true);
    expect(PARAGRAPH_LABELS.includes(proof)).toBe(true);
  });
});

describe("COMMON block (embedded in every prompt system)", () => {
  const systems = [
    classificationPrompt(["p"]).system,
    entitiesPrompt("c").system,
    statementsPrompt("c", ["e"]).system,
    itemsPrompt("c", ["e"]).system,
    assetsPrompt("c", ["e"]).system,
    dependenciesPrompt("c", ["e"]).system,
  ];

  it("every prompt system starts with the exact COMMON rules block", () => {
    for (const sys of systems) {
      expect(sys.startsWith(COMMON)).toBe(true);
    }
  });

  it("COMMON carries all four load-bearing rules verbatim", () => {
    expect(COMMON).toContain("Output ONLY valid JSON in the requested shape. No prose, no markdown.");
    expect(COMMON).toContain(
      'Every "quote" MUST be copied CHARACTER-FOR-CHARACTER from the passage. Never paraphrase a quote.',
    );
    expect(COMMON).toContain('Every "text" MUST be written in your OWN words — never copy the source into "text".');
    expect(COMMON).toContain("Do NOT invent a confidence, trust, or verified field. You propose; you do not judge.");
  });
});

describe("classificationPrompt", () => {
  it("system: COMMON, then task + labels joined with ' | ', ending with the exact Shape line", () => {
    const { system } = classificationPrompt(["only one"]);
    expect(
      system.startsWith(
        `${COMMON}\nTask: label EVERY numbered paragraph with the kind of text it is.\nLabels: CANONICAL | EXAMPLE | PROBLEM | QUESTION | HISTORY | CONTEXT | MOTIVATION | STORY | PROOF | SUMMARY.\n`,
      ),
    ).toBe(true);
    // label legend (asserted per-column to sidestep the alignment whitespace between columns)
    expect(system).toContain("- CANONICAL: the exposition a student must learn (definitions, properties, rules)");
    expect(system).toContain("- PROOF: a derivation or justification");
    expect(system).toContain("- SUMMARY: a recap of what was covered");
    expect(system).toContain("- EXAMPLE: a worked example");
    expect(system).toContain("- PROBLEM: an exercise to solve");
    expect(system).toContain("- QUESTION: a question posed to the reader");
    expect(system).toContain("- HISTORY: who discovered it and when");
    expect(system).toContain("- CONTEXT / MOTIVATION: framing or why-it-matters text");
    expect(system).toContain("- STORY: narrative or anecdote");
    expect(system).toContain(
      "Return one entry per input paragraph, echoing its index. Do not merge, reorder or skip paragraphs.",
    );
    expect(system.endsWith('Shape: { "paragraphs": [ { "index": number, "label": string } ] }')).toBe(true);
  });

  it("user: multi paragraphs → each prefixed with its [index], joined by a blank line", () => {
    const { user } = classificationPrompt(["Alpha", "Beta", "Gamma"]);
    expect(user).toBe("[0] Alpha\n\n[1] Beta\n\n[2] Gamma");
  });

  it("user: single paragraph → '[0] <text>' with no separator", () => {
    expect(classificationPrompt(["Solo passage"]).user).toBe("[0] Solo passage");
  });

  it("user: empty paragraph list → '' (map over [] then join)", () => {
    const { system, user } = classificationPrompt([]);
    expect(user).toBe("");
    // system does not depend on the paragraphs — labels are still present
    expect(system).toContain("Labels: CANONICAL | EXAMPLE");
  });

  it("user: preserves an empty-string paragraph as its index prefix only", () => {
    expect(classificationPrompt(["", "x"]).user).toBe("[0] \n\n[1] x");
  });
});

describe("entitiesPrompt", () => {
  const TASK = "Task: list the distinct teachable CONCEPTS (entities/skills) the passage is ABOUT.";

  it("default hint '' (ternary false branch): system = COMMON immediately followed by the task", () => {
    const { system } = entitiesPrompt("chunk body");
    expect(system.startsWith(`${COMMON}\n${TASK}`)).toBe(true);
    // no hint line was inserted between COMMON and the task
    expect(system.startsWith(`${COMMON}\n\n`)).toBe(false);
  });

  it("explicit hint (ternary true branch): '\\n<hint>' is inserted between COMMON and the task", () => {
    const { system } = entitiesPrompt("chunk body", "PRIOR: focus on trigonometry");
    expect(system.startsWith(`${COMMON}\nPRIOR: focus on trigonometry\n${TASK}`)).toBe(true);
  });

  it("system carries the exclusion rules, the syllabus test, the worked example, and the Shape", () => {
    const { system } = entitiesPrompt("x");
    expect(system).toContain(
      "INCLUDE: ideas a student must learn — theorems, definitions, methods, quantities, phenomena, skills.",
    );
    expect(system).toContain(
      "- props and settings invented for an example or exercise (a tower, a building, a person's name, a city, a price, a date)",
    );
    expect(system).toContain("- worked-example specifics (the particular numbers, the particular triangle)");
    expect(system).toContain("- section headings, figure/table captions, exercise numbers");
    expect(system).toContain('Ask of each candidate: "would this appear in a syllabus?" If no, leave it out.');
    expect(system).toContain(
      'Example passage: "A boy standing 15 m from the Qutub Minar observes its top at 60°. Use the tangent',
    );
    expect(system).toContain('CORRECT: ["tangent ratio", "angle of elevation", "height and distance problems"]');
    expect(system).toContain('WRONG:');
    expect(system).toContain('["Qutub Minar", "boy", "15 m", "60 degrees"]');
    expect(system).toContain("props, not concepts");
    expect(system.endsWith('Shape: { "entities": [ { "name": string, "aliases"?: string[], "kind"?: "ENTITY"|"SKILL" } ] }')).toBe(true);
  });

  it("user is the chunk text verbatim (untouched)", () => {
    expect(entitiesPrompt("The exact chunk\nwith a newline").user).toBe("The exact chunk\nwith a newline");
  });
});

describe("statementsPrompt", () => {
  const TASK = "Task: extract EVERY assertion the passage makes, each grounded in an exact quote.";

  it("default hint '' (false branch): COMMON directly followed by the task line", () => {
    const { system } = statementsPrompt("chunk", ["prime factorisation"]);
    expect(system.startsWith(`${COMMON}\n${TASK}`)).toBe(true);
  });

  it("explicit hint (true branch): '\\n<hint>' inserted before the task", () => {
    const { system } = statementsPrompt("chunk", ["prime factorisation"], "PRIOR: Real Numbers chapter");
    expect(system.startsWith(`${COMMON}\nPRIOR: Real Numbers chapter\n${TASK}`)).toBe(true);
  });

  it("Known concepts line lists the entity names joined with ', ' when non-empty", () => {
    const { system } = statementsPrompt("chunk", ["Fundamental Theorem of Arithmetic", "prime factorisation"]);
    expect(system).toContain("Known concepts: Fundamental Theorem of Arithmetic, prime factorisation.");
  });

  it("Known concepts falls back to '(none yet)' when the list is empty (|| branch)", () => {
    const { system } = statementsPrompt("chunk", []);
    expect(system).toContain("Known concepts: (none yet).");
  });

  it("Known concepts falls back to '(none yet)' for a single empty-string name (join yields '' → falsy)", () => {
    const { system } = statementsPrompt("chunk", [""]);
    expect(system).toContain("Known concepts: (none yet).");
  });

  it("system carries exhaustiveness, mandatory-subject, the do/don't rules, the worked example, and the Shape", () => {
    const { system } = statementsPrompt("chunk", ["x"]);
    expect(system).toContain(
      "A typical passage",
    );
    expect(system).toContain("returning two or three means you stopped early.");
    expect(system).toContain(
      'Every statement MUST name the concept it is about in "subject" — for EVERY form, not only SPO.',
    );
    expect(system).toContain("A statement with no subject is discarded.");
    expect(system).toContain(
      "Do NOT extract: exercise instructions, figure captions, or the arithmetic of a worked example.",
    );
    expect(system).toContain("DO extract the rule or property the worked example demonstrates.");
    expect(system).toContain(
      'The Fundamental Theorem of Arithmetic states that every composite number can be',
    );
    expect(system).toContain(
      '"quote": "every composite number can be factorised as a product of primes"',
    );
    expect(system).toContain(
      '"quote": "this factorisation is unique apart from the order"',
    );
    expect(system).toContain(
      '"form": "SPO"|"DEFINITIONAL"|"CAUSAL"|"CONDITIONAL"|"COMPARATIVE"|"QUANTIFIED"|"PROBABILISTIC",',
    );
    expect(system).toContain(
      '"kind": "FACT"|"PROCEDURE"|"PRINCIPLE"|"RULE"|"DEFINITION"|"RELATIONSHIP",',
    );
    expect(system.endsWith("} ] }")).toBe(true);
  });

  it("user is the chunk text verbatim", () => {
    expect(statementsPrompt("STMT CHUNK", ["a"]).user).toBe("STMT CHUNK");
  });
});

describe("itemsPrompt", () => {
  it("system: COMMON + assessment task + MCQ rule + Known concepts list (non-empty) + shapes", () => {
    const { system } = itemsPrompt("chunk", ["tangent ratio", "angle of elevation"]);
    expect(system.startsWith(`${COMMON}\nTask: propose ASSESSMENT items testing the known concepts. Kinds: MCQ, SHORT, NUMERIC.`)).toBe(true);
    expect(system).toContain(
      "For MCQ, EVERY wrong option (distractor) SHOULD name the misconception it diagnoses.",
    );
    expect(system).toContain("Known concepts: tangent ratio, angle of elevation.");
    expect(system).toContain(
      'Shape: { "items": [ { "kind": "MCQ"|"SHORT"|"NUMERIC", "conceptName": string, "prompt": string,',
    );
    expect(system.endsWith(
      'MCQ payload: { "options": [ { "text": string, "correct": boolean, "diagnosesMisconception"?: string } ] }',
    )).toBe(true);
  });

  it("Known concepts falls back to '(none yet)' when empty (|| branch)", () => {
    expect(itemsPrompt("chunk", []).system).toContain("Known concepts: (none yet).");
  });

  it("user is the chunk text verbatim", () => {
    expect(itemsPrompt("ITEMS CHUNK", ["a"]).user).toBe("ITEMS CHUNK");
  });
});

describe("assetsPrompt", () => {
  it("system: COMMON + teaching-assets task + the three kinds + breakdownPoint rule + Shape", () => {
    const { system } = assetsPrompt("chunk", ["photosynthesis"]);
    expect(system.startsWith(`${COMMON}\nTask: propose TEACHING assets for the known concepts. Phase 2 accepts THREE kinds only:`)).toBe(true);
    expect(system).toContain('- MISCONCEPTION { "misconception": string, "correction": string }');
    expect(system).toContain(
      '- ANALOGY { "source": string, "mapping": string, "breakdownPoint": string }  ← breakdownPoint is MANDATORY',
    );
    expect(system).toContain('- WORKED_EXAMPLE { "problem": string, "steps": string[], "answer": string }');
    expect(system).toContain(
      "Every ANALOGY MUST state where the analogy breaks down, or it installs a misconception.",
    );
    expect(system).toContain("Known concepts: photosynthesis.");
    expect(system.endsWith(
      'Shape: { "assets": [ { "kind": "MISCONCEPTION"|"ANALOGY"|"WORKED_EXAMPLE", "conceptName": string, "payload": object } ] }',
    )).toBe(true);
  });

  it("Known concepts falls back to '(none yet)' when empty (|| branch)", () => {
    expect(assetsPrompt("chunk", []).system).toContain("Known concepts: (none yet).");
  });

  it("user is the chunk text verbatim", () => {
    expect(assetsPrompt("ASSETS CHUNK", ["a"]).user).toBe("ASSETS CHUNK");
  });
});

describe("dependenciesPrompt", () => {
  it("system: COMMON + relationships task with the three classifications + human-confirm + Shape", () => {
    const { system } = dependenciesPrompt("chunk", ["A", "B"]);
    expect(system.startsWith(`${COMMON}\nTask: propose relationships between the known concepts. CLASSIFY each: REQUIRES (must learn A before B),`)).toBe(true);
    expect(system).toContain(
      "PART_OF (structural containment), or REINFORCEMENT (mutually strengthening). A human will confirm every classification.",
    );
    expect(system).toContain("Known concepts: A, B.");
    expect(system).toContain(
      'Shape: { "dependencies": [ { "fromName": string, "toName": string,',
    );
    expect(system.endsWith(
      '"classification": "REQUIRES"|"PART_OF"|"REINFORCEMENT", "type"?: string } ] }',
    )).toBe(true);
  });

  it("Known concepts falls back to '(none yet)' when empty (|| branch)", () => {
    expect(dependenciesPrompt("chunk", []).system).toContain("Known concepts: (none yet).");
  });

  it("user is the chunk text verbatim", () => {
    expect(dependenciesPrompt("DEPS CHUNK", ["a"]).user).toBe("DEPS CHUNK");
  });
});
