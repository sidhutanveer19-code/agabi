import { describe, it, expect } from "vitest";
import { accept } from "@/server/advisors/advice";
import { extractEntities } from "@/server/advisors/knowledge/extractEntities";
import { extractStatements } from "@/server/advisors/knowledge/extractStatements";
import { extractDependencies } from "@/server/advisors/knowledge/extractDependencies";
import { PROMPT_VERSION } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import { RawEntitiesSchema, RawStatementsSchema, RawDependenciesSchema } from "@/server/knowledge/extraction/schemas";

// A fake invoker returning fixture JSON — no live model, free or otherwise.
const fake = (data: Record<string, unknown>): JsonInvoke => async () => ({ raw: JSON.stringify(data), data });

describe("knowledge extractors (advisors) — trust boundary", () => {
  it("PROMPT_VERSION is stamped and stable", () => {
    expect(PROMPT_VERSION).toBe("knowledge-extract@1");
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
