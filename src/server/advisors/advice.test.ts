import { describe, it, expect } from "vitest";
import { z } from "zod";
import { advise, accept, acceptEach } from "@/server/advisors/advice";

/**
 * advise / accept / acceptEach — the trust boundary that turns UNTRUSTED raw model
 * output into validated `T`. This module has NO I/O edge (no db/clock/network), so
 * nothing is mocked: zod is exercised for real with hostile input, which is the only
 * honest way to test a validator (a fake schema would prove the fake). Every branch is
 * driven and its REAL output asserted — the returned value / null, the exact dropped
 * record (index, path, code, message, preview), never "it ran".
 *
 * Branch map:
 *   advise    — the single wrap; raw preserved verbatim, phantom __t never materialised.
 *   accept    — `r.success ? r.data : null` (validated data out vs null on ANY failure).
 *   acceptEach:
 *     !Array.isArray(raw)  — the ternary `raw === null ? "null" : typeof raw`
 *                            (null side + typeof side: undefined/object/number/string)
 *                            and the preview `JSON.stringify(raw ?? null)`
 *                            (nullish → "null"; falsy-but-present 0 kept, not nulled).
 *     array path           — empty (boundary), all-valid (parsed data pushed),
 *                            per-element failure with `issue.path.join('.') || '(root)'`
 *                            (field path vs root), first-issue-only (`issues[0]`),
 *                            preview truncation to 200, and a mixed batch (A-6).
 */

// A statement-shaped element mirroring the real extraction schema the boundary guards.
const stmtSchema = z.object({
  form: z.enum(["SPO", "DEFINITIONAL", "CAUSAL"]),
  text: z.string(),
});
type Stmt = z.infer<typeof stmtSchema>;

describe("advise — wraps raw as branded advice, verbatim", () => {
  it("preserves an object raw by reference and stamps the brand; phantom __t never set", () => {
    const raw = { form: "SPO", text: "hi" };
    const a = advise<Stmt>(raw);
    expect(a.__brand).toBe("advice");
    expect(a.raw).toBe(raw); // same reference — no copy, no mutation
    expect("__t" in a).toBe(false); // phantom type field is compile-time only
    expect(Object.keys(a)).toEqual(["__brand", "raw"]);
  });

  it("preserves primitive, null and undefined raws unchanged", () => {
    expect(advise<number>(0).raw).toBe(0);
    expect(advise<string>("").raw).toBe("");
    expect(advise<null>(null).raw).toBeNull();
    expect(advise<undefined>(undefined).raw).toBeUndefined();
  });
});

describe("accept — the only unwrap: validated data or null, never throws", () => {
  it("success branch returns the PARSED data (r.data), not the raw input", () => {
    // coercion proves it returns what zod produced, not what came in.
    const out = accept(advise<number>("42"), z.coerce.number());
    expect(out).toBe(42);
    expect(typeof out).toBe("number");
  });

  it("success branch on an object schema returns the validated object", () => {
    const out = accept(advise<Stmt>({ form: "SPO", text: "water boils" }), stmtSchema);
    expect(out).toEqual({ form: "SPO", text: "water boils" });
  });

  it("failure branch returns exactly null (invalid value)", () => {
    expect(accept(advise<number>("not a number"), z.number())).toBeNull();
  });

  it("failure branch returns null for a structurally wrong object", () => {
    expect(accept(advise<Stmt>({ form: "HISTORICAL", text: "x" }), stmtSchema)).toBeNull();
  });

  it("does not throw on undefined raw — returns null", () => {
    let out: number | null = 0;
    expect(() => {
      out = accept(advise<number>(undefined), z.number());
    }).not.toThrow();
    expect(out).toBeNull();
  });
});

describe("acceptEach — non-array raw is refused as one 'not_an_array' drop", () => {
  it("raw === null → ternary null-side message, preview 'null'", () => {
    const res = acceptEach(advise<Stmt[]>(null), stmtSchema);
    expect(res.accepted).toEqual([]);
    expect(res.dropped).toEqual([
      {
        index: -1,
        path: "(root)",
        code: "not_an_array",
        message: "expected an array, got null",
        preview: "null",
      },
    ]);
  });

  it("raw === undefined → typeof-side message 'undefined', preview 'null' via ?? ", () => {
    const res = acceptEach(advise<Stmt[]>(undefined), stmtSchema);
    expect(res.accepted).toEqual([]);
    expect(res.dropped[0].message).toBe("expected an array, got undefined");
    expect(res.dropped[0].preview).toBe("null"); // undefined ?? null → JSON.stringify(null)
    expect(res.dropped[0].code).toBe("not_an_array");
    expect(res.dropped[0].index).toBe(-1);
  });

  it("raw is a plain object → 'got object', preview is the object's JSON (kept by ??)", () => {
    const res = acceptEach(advise<Stmt[]>({ a: 1 }), stmtSchema);
    expect(res.dropped[0].message).toBe("expected an array, got object");
    expect(res.dropped[0].preview).toBe('{"a":1}');
  });

  it("raw is 0 (falsy but NOT nullish) → 'got number', preview '0' (?? keeps 0)", () => {
    const res = acceptEach(advise<Stmt[]>(0), stmtSchema);
    expect(res.dropped[0].message).toBe("expected an array, got number");
    expect(res.dropped[0].preview).toBe("0");
  });

  it("raw is a string → 'got string', preview is the quoted JSON string", () => {
    const res = acceptEach(advise<Stmt[]>("nope"), stmtSchema);
    expect(res.dropped[0].message).toBe("expected an array, got string");
    expect(res.dropped[0].preview).toBe('"nope"');
  });
});

describe("acceptEach — array path", () => {
  it("empty array → nothing accepted, nothing dropped", () => {
    expect(acceptEach(advise<Stmt[]>([]), stmtSchema)).toEqual({ accepted: [], dropped: [] });
  });

  it("all elements valid → every element accepted as PARSED data, no drops", () => {
    // z.coerce proves accepted holds r.data, not the raw string inputs.
    const res = acceptEach(advise<number[]>(["1", "2", "3"]), z.coerce.number());
    expect(res.accepted).toEqual([1, 2, 3]);
    expect(res.dropped).toEqual([]);
  });

  it("one invalid element with a FIELD path → path is the field, drop is precise", () => {
    const res = acceptEach(advise<Stmt[]>([{ form: "HISTORICAL", text: "x" }]), stmtSchema);
    expect(res.accepted).toEqual([]);
    expect(res.dropped).toHaveLength(1);
    const d = res.dropped[0];
    expect(d.index).toBe(0);
    expect(d.path).toBe("form"); // issue.path.join('.') — left side of ||
    expect(d.code).toBe("invalid_value");
    expect(d.message).toContain("Invalid option");
    expect(d.preview).toBe('{"form":"HISTORICAL","text":"x"}');
  });

  it("invalid element with EMPTY path (root type mismatch) → path falls back to '(root)'", () => {
    // element schema is a bare number; a string element fails at the root (path []).
    const res = acceptEach(advise<number[]>(["ok-is-not", 7]), z.number());
    expect(res.accepted).toEqual([7]);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].index).toBe(0);
    expect(res.dropped[0].path).toBe("(root)"); // '' || '(root)' → right side
    expect(res.dropped[0].code).toBe("invalid_type");
  });

  it("element with TWO problems → records only issues[0] (first field, in schema order)", () => {
    const res = acceptEach(advise<Stmt[]>([{ form: "BAD", text: 123 }]), stmtSchema);
    expect(res.dropped).toHaveLength(1);
    // form (invalid_value) precedes text (invalid_type); only the first issue is reported.
    expect(res.dropped[0].path).toBe("form");
    expect(res.dropped[0].code).toBe("invalid_value");
  });

  it("preview is truncated to 200 chars", () => {
    const huge = { form: "SPO", text: "z".repeat(500) };
    const res = acceptEach(advise<Stmt[]>([huge]), stmtSchema); // form/text valid types → but text ok; force a fail instead
    // huge is actually VALID (text is a string), so it is accepted — assert that, then test truncation on a failing element.
    expect(res.accepted).toHaveLength(1);

    const bad = { form: "HISTORICAL", pad: "y".repeat(500) };
    const res2 = acceptEach(advise<Stmt[]>([bad]), stmtSchema);
    expect(res2.dropped).toHaveLength(1);
    expect(res2.dropped[0].preview).toHaveLength(200);
    expect(res2.dropped[0].preview).toBe(JSON.stringify(bad).slice(0, 200));
  });

  it("mixed batch (A-6 real failure) → good rows kept, bad row reported with its index", () => {
    const batch = [
      { form: "SPO", text: "good one" },
      { form: "HISTORICAL", text: "invented enum" }, // the exact real-corpus defect
      { form: "DEFINITIONAL", text: "good two" },
    ];
    const res = acceptEach(advise<Stmt[]>(batch), stmtSchema);

    expect(res.accepted).toEqual([
      { form: "SPO", text: "good one" },
      { form: "DEFINITIONAL", text: "good two" },
    ]);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].index).toBe(1); // original array index, not accepted index
    expect(res.dropped[0].path).toBe("form");
    expect(res.dropped[0].preview).toContain("HISTORICAL");
  });

  it("multiple invalid elements → each dropped, in order, with correct indices", () => {
    const batch = [
      { form: "NOPE", text: "a" },
      { form: "SPO", text: "b" },
      { form: "ALSO-NOPE", text: "c" },
    ];
    const res = acceptEach(advise<Stmt[]>(batch), stmtSchema);
    expect(res.accepted).toEqual([{ form: "SPO", text: "b" }]);
    expect(res.dropped.map((d) => d.index)).toEqual([0, 2]);
    expect(res.dropped.every((d) => d.code === "invalid_value")).toBe(true);
  });
});
