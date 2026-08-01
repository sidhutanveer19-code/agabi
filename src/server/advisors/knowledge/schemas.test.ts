import { describe, it, expect } from "vitest";
import { z } from "zod";

import { DependenciesResponse, EntitiesResponse, StatementsResponse } from "@/server/advisors/knowledge/schemas";

/**
 * Advisor-side response envelopes (loose zod schemas). No I/O — this is pure
 * parse/validate LOGIC, so nothing is mocked; every branch is exercised for real
 * with hostile input. For SUCCESS paths we assert the EXACT parsed value (including
 * zod's default unknown-key stripping and optional-key omission); for FAILURE paths
 * we assert there is EXACTLY ONE issue with the exact `invalid_type` code, the exact
 * `.path` into the tree, and the exact `.expected` type — never merely "it failed".
 */

/** Assert a safeParse failed with a single `invalid_type` issue at `path` expecting `expected`. */
function assertSingleInvalidType(
  result: z.ZodSafeParseResult<unknown>,
  path: (string | number)[],
  expected: string,
): void {
  expect(result.success).toBe(false);
  if (result.success) throw new Error("expected parse to fail, but it succeeded");
  expect(result.error.issues).toHaveLength(1);
  const issue = result.error.issues[0];
  expect(issue.code).toBe("invalid_type");
  if (issue.code !== "invalid_type") throw new Error("expected an invalid_type issue");
  expect(issue.expected).toBe(expected);
  expect(issue.path).toEqual(path);
}

describe("EntitiesResponse — success paths (exact parsed value)", () => {
  it("minimal entity: only required `name` survives; optional aliases/kind keys are ABSENT", () => {
    const parsed = EntitiesResponse.parse({ entities: [{ name: "Newton" }] });
    expect(parsed).toEqual({ entities: [{ name: "Newton" }] });
    // optionals omitted → keys must not exist at all (not `undefined`)
    expect("aliases" in parsed.entities[0]).toBe(false);
    expect("kind" in parsed.entities[0]).toBe(false);
  });

  it("full entity: aliases array + kind are kept verbatim", () => {
    const parsed = EntitiesResponse.parse({
      entities: [{ name: "Newton", aliases: ["Sir Isaac", "Isaac"], kind: "person" }],
    });
    expect(parsed).toEqual({
      entities: [{ name: "Newton", aliases: ["Sir Isaac", "Isaac"], kind: "person" }],
    });
  });

  it("empty entities array is valid → parses to an empty array", () => {
    expect(EntitiesResponse.parse({ entities: [] })).toEqual({ entities: [] });
  });

  it("empty aliases array is preserved (present-but-empty ≠ omitted)", () => {
    const parsed = EntitiesResponse.parse({ entities: [{ name: "x", aliases: [] }] });
    expect(parsed).toEqual({ entities: [{ name: "x", aliases: [] }] });
    expect("aliases" in parsed.entities[0]).toBe(true);
  });

  it("unknown keys are STRIPPED at both the root and the entity level", () => {
    const parsed = EntitiesResponse.parse({
      entities: [{ name: "x", kind: "k", bogus: 123 }],
      junk: true,
    } as unknown as { entities: { name: string }[] });
    expect(parsed).toEqual({ entities: [{ name: "x", kind: "k" }] });
    expect("junk" in parsed).toBe(false);
  });

  it("multiple entities all parse in order", () => {
    const parsed = EntitiesResponse.parse({ entities: [{ name: "A" }, { name: "B", kind: "topic" }] });
    expect(parsed).toEqual({ entities: [{ name: "A" }, { name: "B", kind: "topic" }] });
  });
});

describe("EntitiesResponse — failure paths (exact issue)", () => {
  it("missing required `name` → invalid_type at entities.0.name expecting string", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ kind: "person" }] }),
      ["entities", 0, "name"],
      "string",
    );
  });

  it("`name` wrong type (number) → invalid_type at entities.0.name expecting string", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ name: 5 }] }),
      ["entities", 0, "name"],
      "string",
    );
  });

  it("invalid entity is reported at its real index (index 1, not 0)", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ name: "ok" }, { name: 3 }] }),
      ["entities", 1, "name"],
      "string",
    );
  });

  it("`aliases` not an array → invalid_type at entities.0.aliases expecting array", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ name: "x", aliases: "nope" }] }),
      ["entities", 0, "aliases"],
      "array",
    );
  });

  it("`aliases` element not a string → invalid_type at entities.0.aliases.0 expecting string", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ name: "x", aliases: [1] }] }),
      ["entities", 0, "aliases", 0],
      "string",
    );
  });

  it("`kind` wrong type (number) → invalid_type at entities.0.kind expecting string", () => {
    assertSingleInvalidType(
      EntitiesResponse.safeParse({ entities: [{ name: "x", kind: 9 }] }),
      ["entities", 0, "kind"],
      "string",
    );
  });

  it("`entities` not an array → invalid_type at entities expecting array", () => {
    assertSingleInvalidType(EntitiesResponse.safeParse({ entities: "nope" }), ["entities"], "array");
  });

  it("`entities` missing entirely → invalid_type at entities expecting array", () => {
    assertSingleInvalidType(EntitiesResponse.safeParse({}), ["entities"], "array");
  });

  it("root null → invalid_type at [] expecting object", () => {
    assertSingleInvalidType(EntitiesResponse.safeParse(null), [], "object");
  });

  it(".parse() (not safeParse) THROWS a ZodError on invalid input", () => {
    expect(() => EntitiesResponse.parse({})).toThrow(z.ZodError);
  });
});

describe("StatementsResponse — success paths (exact parsed value)", () => {
  const required = { form: "declarative", kind: "fact", text: "Water boils.", quote: "Water boils at 100C." };

  it("minimal statement: only the 4 required strings; every optional key ABSENT", () => {
    const parsed = StatementsResponse.parse({ statements: [{ ...required }] });
    expect(parsed).toEqual({ statements: [required] });
    const s = parsed.statements[0];
    for (const opt of ["structure", "subject", "predicate", "object", "objectLit"]) {
      expect(opt in s).toBe(false);
    }
  });

  it("full statement: structure record + all optional string fields kept verbatim", () => {
    const full = {
      ...required,
      structure: { subjectRef: "s1", depth: 2, tags: ["a", "b"] },
      subject: "water",
      predicate: "boils_at",
      object: "temperature",
      objectLit: "100C",
    };
    expect(StatementsResponse.parse({ statements: [full] })).toEqual({ statements: [full] });
  });

  it("structure accepts a record with heterogeneous unknown values", () => {
    const parsed = StatementsResponse.parse({
      statements: [{ ...required, structure: { n: 1, s: "x", b: true, nested: { deep: [1, 2] }, nil: null } }],
    });
    expect(parsed.statements[0].structure).toEqual({ n: 1, s: "x", b: true, nested: { deep: [1, 2] }, nil: null });
  });

  it("empty statements array is valid", () => {
    expect(StatementsResponse.parse({ statements: [] })).toEqual({ statements: [] });
  });

  it("unknown keys inside a statement are stripped", () => {
    const parsed = StatementsResponse.parse({
      statements: [{ ...required, extra: "drop me" }],
    } as unknown as { statements: (typeof required)[] });
    expect(parsed).toEqual({ statements: [required] });
  });
});

describe("StatementsResponse — failure paths (exact issue)", () => {
  const req = { form: "f", kind: "k", text: "t", quote: "q" };

  it("missing `quote` → invalid_type at statements.0.quote expecting string", () => {
    assertSingleInvalidType(
      StatementsResponse.safeParse({ statements: [{ form: "f", kind: "k", text: "t" }] }),
      ["statements", 0, "quote"],
      "string",
    );
  });

  it("missing `form` → invalid_type at statements.0.form expecting string", () => {
    assertSingleInvalidType(
      StatementsResponse.safeParse({ statements: [{ kind: "k", text: "t", quote: "q" }] }),
      ["statements", 0, "form"],
      "string",
    );
  });

  it("`text` wrong type (number) → invalid_type at statements.0.text expecting string", () => {
    assertSingleInvalidType(
      StatementsResponse.safeParse({ statements: [{ form: "f", kind: "k", text: 5, quote: "q" }] }),
      ["statements", 0, "text"],
      "string",
    );
  });

  it("`structure` wrong type (string) → invalid_type at statements.0.structure expecting record", () => {
    assertSingleInvalidType(
      StatementsResponse.safeParse({ statements: [{ ...req, structure: "not-a-record" }] }),
      ["statements", 0, "structure"],
      "record",
    );
  });

  it("`subject` wrong type (number) → invalid_type at statements.0.subject expecting string", () => {
    assertSingleInvalidType(
      StatementsResponse.safeParse({ statements: [{ ...req, subject: 7 }] }),
      ["statements", 0, "subject"],
      "string",
    );
  });

  it("`statements` missing entirely → invalid_type at statements expecting array", () => {
    assertSingleInvalidType(StatementsResponse.safeParse({}), ["statements"], "array");
  });
});

describe("DependenciesResponse — success paths (exact parsed value)", () => {
  it("minimal dependency: 3 required strings; optional `type` key ABSENT", () => {
    const parsed = DependenciesResponse.parse({
      dependencies: [{ fromName: "A", toName: "B", classification: "prerequisite" }],
    });
    expect(parsed).toEqual({ dependencies: [{ fromName: "A", toName: "B", classification: "prerequisite" }] });
    expect("type" in parsed.dependencies[0]).toBe(false);
  });

  it("dependency with optional `type` kept verbatim", () => {
    const parsed = DependenciesResponse.parse({
      dependencies: [{ fromName: "A", toName: "B", classification: "prerequisite", type: "hard" }],
    });
    expect(parsed).toEqual({
      dependencies: [{ fromName: "A", toName: "B", classification: "prerequisite", type: "hard" }],
    });
  });

  it("empty dependencies array is valid", () => {
    expect(DependenciesResponse.parse({ dependencies: [] })).toEqual({ dependencies: [] });
  });

  it("unknown keys are stripped", () => {
    const parsed = DependenciesResponse.parse({
      dependencies: [{ fromName: "A", toName: "B", classification: "c", weight: 9 }],
    } as unknown as { dependencies: { fromName: string; toName: string; classification: string }[] });
    expect(parsed).toEqual({ dependencies: [{ fromName: "A", toName: "B", classification: "c" }] });
  });
});

describe("DependenciesResponse — failure paths (exact issue)", () => {
  const dep = { fromName: "A", toName: "B", classification: "c" };

  it("missing `fromName` → invalid_type at dependencies.0.fromName expecting string", () => {
    assertSingleInvalidType(
      DependenciesResponse.safeParse({ dependencies: [{ toName: "B", classification: "c" }] }),
      ["dependencies", 0, "fromName"],
      "string",
    );
  });

  it("missing `toName` → invalid_type at dependencies.0.toName expecting string", () => {
    assertSingleInvalidType(
      DependenciesResponse.safeParse({ dependencies: [{ fromName: "A", classification: "c" }] }),
      ["dependencies", 0, "toName"],
      "string",
    );
  });

  it("missing `classification` → invalid_type at dependencies.0.classification expecting string", () => {
    assertSingleInvalidType(
      DependenciesResponse.safeParse({ dependencies: [{ fromName: "A", toName: "B" }] }),
      ["dependencies", 0, "classification"],
      "string",
    );
  });

  it("`type` wrong type (number) → invalid_type at dependencies.0.type expecting string", () => {
    assertSingleInvalidType(
      DependenciesResponse.safeParse({ dependencies: [{ ...dep, type: 42 }] }),
      ["dependencies", 0, "type"],
      "string",
    );
  });

  it("`dependencies` not an array → invalid_type at dependencies expecting array", () => {
    assertSingleInvalidType(
      DependenciesResponse.safeParse({ dependencies: "nope" }),
      ["dependencies"],
      "array",
    );
  });
});
