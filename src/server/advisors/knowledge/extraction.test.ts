import { describe, it, expect } from "vitest";
import { accept } from "@/server/advisors/advice";
import { extractEntities } from "@/server/advisors/knowledge/extractEntities";
import { extractStatements } from "@/server/advisors/knowledge/extractStatements";
import { extractDependencies } from "@/server/advisors/knowledge/extractDependencies";
import { PROMPT_VERSION, entitiesPrompt, statementsPrompt } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import { RawEntitiesSchema, RawStatementsSchema, RawDependenciesSchema } from "@/server/knowledge/extraction/schemas";

// A fake invoker returning fixture JSON — no live model, free or otherwise.
const fake = (data: Record<string, unknown>): JsonInvoke => async () => ({ raw: JSON.stringify(data), data });

describe("knowledge extractors (advisors) — trust boundary", () => {
  it("PROMPT_VERSION is stamped and stable", () => {
    // Pinned deliberately: provenance records it, so a bump must be a decision, not a drift.
    // @2 = entity exclusion rule + few-shot (2a), statement exhaustiveness + mandatory subject (2d).
    expect(PROMPT_VERSION).toBe("knowledge-extract@2");
  });

  it("@2 prompts carry the two rules the graph depends on", () => {
    const ents = entitiesPrompt("some passage").system;
    expect(ents).toContain("EXCLUDE"); // props/exercise specifics must not become concepts
    expect(ents).toContain("Qutub Minar"); // the few-shot negative example
    const stmts = statementsPrompt("some passage", ["prime factorisation"]).system;
    expect(stmts).toContain("EVERY assertion"); // exhaustiveness
    expect(stmts).toContain("for EVERY form"); // subject required on non-SPO forms (A-5)
    expect(stmts).toContain("prime factorisation"); // known concepts threaded through
  });

  it("extractEntities wraps raw output as Advice; accept() validates it", async () => {
    const advice = await extractEntities("chunk", fake({ entities: [{ name: "Photosynthesis", kind: "ENTITY" }] }));
    const entities = accept(advice, RawEntitiesSchema);
    expect(entities).toEqual([{ name: "Photosynthesis", kind: "ENTITY" }]);
  });

  it("accept() STRIPS any trust field a model tries to smuggle in (ADR-2)", async () => {
    // The model emits a rogue trustLevel/verified; the schema has no such field, so it is dropped.
    const advice = await extractStatements(
      "chunk",
      ["Photosynthesis"],
      fake({
        statements: [
          {
            form: "SPO", kind: "FACT", text: "own words", quote: "an exact source quote here",
            structure: { subjectId: "a", predicate: "p", objectId: "b" },
            trustLevel: "AGABI_CANONICAL", verified: true,
          },
        ],
      }),
    );
    const statements = accept(advice, RawStatementsSchema) as Array<Record<string, unknown>> | null;
    expect(statements).toHaveLength(1);
    expect(statements![0]).not.toHaveProperty("trustLevel");
    expect(statements![0]).not.toHaveProperty("verified");
  });

  it("extractDependencies proposes classified edges (confirmed by a human downstream)", async () => {
    const advice = await extractDependencies(
      "chunk",
      ["A", "B"],
      fake({ dependencies: [{ fromName: "B", toName: "A", classification: "REQUIRES" }] }),
    );
    const deps = accept(advice, RawDependenciesSchema);
    expect(deps).toEqual([{ fromName: "B", toName: "A", classification: "REQUIRES" }]);
  });

  it("malformed model output fails accept() cleanly (returns null, never throws)", async () => {
    const advice = await extractEntities("chunk", fake({ entities: [{ notAName: 1 }] }));
    expect(accept(advice, RawEntitiesSchema)).toBeNull();
  });
});
