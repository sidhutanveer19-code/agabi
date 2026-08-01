import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { validateGolden, loadGolden } from "@/server/knowledge/extraction/goldenSchema";

describe("golden framework (W6) — the framework, not the datasets", () => {
  it("validates a well-formed golden", () => {
    expect(validateGolden({ statements: [{ subject: "A", predicate: "r", object: "B" }] }).statements).toHaveLength(1);
  });

  it("rejects a malformed golden (empty or missing fields)", () => {
    expect(() => validateGolden({ statements: [] })).toThrow();
    expect(() => validateGolden({ statements: [{ subject: "A" }] })).toThrow();
    expect(() => validateGolden({})).toThrow();
  });

  it("loads + validates the committed sample golden", () => {
    const g = loadGolden(join(process.cwd(), "datasets", "sample-science", "golden.json"));
    expect(g.statements).toHaveLength(2);
    expect(g.statements[0]).toEqual({ subject: "Cell", predicate: "bounded-by", object: "Membrane" });
  });
});
