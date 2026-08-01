import { describe, expect, it } from "vitest";
import { z } from "zod";

import { chartSchema, listSchema, mathSchema, tableSchema } from "@/server/conversation/blockSchemas";

/**
 * blockSchemas — the four server-side block validators (D1). Pure zod, no I/O, so
 * NOTHING is mocked: every assertion drives the REAL schema with real / hostile
 * input and checks the REAL outcome. Accept cases assert the exact parsed `.data`
 * (proving `.passthrough()` keeps model extras and optional fields stay absent);
 * reject cases assert the exact zod issue `code` + `path` at the failing location,
 * never merely "it threw". Branches covered per schema: the success path, every
 * `.min(...)` boundary (empty array / empty string), each optional field
 * present/absent, each field-type mismatch, the enum's valid options + an invalid
 * option, the number|string union's accept-both + reject-boolean, missing required
 * keys, and non-object top-level input.
 */

/** Assert `input` is REJECTED by `schema`, with a zod issue of `code` at exactly `path`. */
function expectReject(
  schema: z.ZodType,
  input: unknown,
  code: string,
  path: ReadonlyArray<string | number>,
): void {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) return; // unreachable after the assertion; narrows the union for TS
  const target = result.error.issues.find(
    (issue) => JSON.stringify(issue.path) === JSON.stringify(path),
  );
  expect(
    target,
    `expected an issue at path ${JSON.stringify(path)}, got ${JSON.stringify(
      result.error.issues.map((i) => ({ code: i.code, path: i.path })),
    )}`,
  ).toBeDefined();
  expect(target?.code).toBe(code);
}

describe("chartSchema — accept", () => {
  it("minimal valid chart parses to exactly the input (no optional keys invented)", () => {
    const input = { kind: "bar", series: [{ key: "a" }], data: [{ x: 1 }] };
    const result = chartSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ kind: "bar", series: [{ key: "a" }], data: [{ x: 1 }] });
    // xKey was never supplied → must NOT appear
    expect("xKey" in result.data).toBe(false);
  });

  it("accepts every one of the five kinds", () => {
    for (const kind of ["bar", "line", "area", "pie", "scatter"] as const) {
      const result = chartSchema.safeParse({ kind, series: [{ key: "a" }], data: [{ x: 1 }] });
      expect(result.success, `kind ${kind} should be valid`).toBe(true);
    }
  });

  it("keeps series color, both number+string data values, xKey, and passthrough extras", () => {
    const input = {
      kind: "scatter",
      series: [{ key: "y", color: "#00ff00" }],
      data: [
        { x: 1, y: 2 },
        { x: "a", y: "b" },
      ],
      xKey: "x",
      stacked: true, // not in the schema → survives via .passthrough()
      title: "Q1",
    };
    const result = chartSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(input);
  });
});

describe("chartSchema — reject", () => {
  it("invalid kind → invalid_value at [kind]", () => {
    expectReject(
      chartSchema,
      { kind: "donut", series: [{ key: "a" }], data: [{ x: 1 }] },
      "invalid_value",
      ["kind"],
    );
  });

  it("empty series (min 1 boundary) → too_small at [series]", () => {
    expectReject(chartSchema, { kind: "bar", series: [], data: [{ x: 1 }] }, "too_small", ["series"]);
  });

  it("series item missing key → invalid_type at [series,0,key]", () => {
    expectReject(
      chartSchema,
      { kind: "bar", series: [{ color: "#fff" }], data: [{ x: 1 }] },
      "invalid_type",
      ["series", 0, "key"],
    );
  });

  it("series color wrong type → invalid_type at [series,0,color]", () => {
    expectReject(
      chartSchema,
      { kind: "bar", series: [{ key: "a", color: 123 }], data: [{ x: 1 }] },
      "invalid_type",
      ["series", 0, "color"],
    );
  });

  it("empty data (min 1 boundary) → too_small at [data]", () => {
    expectReject(chartSchema, { kind: "bar", series: [{ key: "a" }], data: [] }, "too_small", ["data"]);
  });

  it("data value that is neither number nor string → invalid_union at [data,0,x]", () => {
    expectReject(
      chartSchema,
      { kind: "bar", series: [{ key: "a" }], data: [{ x: true }] },
      "invalid_union",
      ["data", 0, "x"],
    );
  });

  it("xKey wrong type → invalid_type at [xKey]", () => {
    expectReject(
      chartSchema,
      { kind: "bar", series: [{ key: "a" }], data: [{ x: 1 }], xKey: 9 },
      "invalid_type",
      ["xKey"],
    );
  });

  it("null (non-object) → invalid_type at the root []", () => {
    expectReject(chartSchema, null, "invalid_type", []);
  });

  it("string (non-object) → invalid_type at the root []", () => {
    expectReject(chartSchema, "not-a-chart", "invalid_type", []);
  });
});

describe("tableSchema — accept", () => {
  it("full valid table parses to exactly the input, colWidths + passthrough kept", () => {
    const input = {
      headers: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
      colWidths: [10, 20],
      caption: "totals", // passthrough
    };
    const result = tableSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(input);
  });

  it("empty rows array is allowed (no min on rows); colWidths omitted stays omitted", () => {
    const result = tableSchema.safeParse({ headers: ["A"], rows: [] });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ headers: ["A"], rows: [] });
    expect("colWidths" in result.data).toBe(false);
  });
});

describe("tableSchema — reject", () => {
  it("empty headers (min 1 boundary) → too_small at [headers]", () => {
    expectReject(tableSchema, { headers: [], rows: [] }, "too_small", ["headers"]);
  });

  it("non-string cell in a row → invalid_type at [rows,0,1]", () => {
    expectReject(tableSchema, { headers: ["h"], rows: [["a", 1]] }, "invalid_type", ["rows", 0, 1]);
  });

  it("non-number colWidth → invalid_type at [colWidths,0]", () => {
    expectReject(
      tableSchema,
      { headers: ["h"], rows: [], colWidths: ["wide"] },
      "invalid_type",
      ["colWidths", 0],
    );
  });

  it("rows omitted (required, no default) → invalid_type at [rows]", () => {
    expectReject(tableSchema, { headers: ["h"] }, "invalid_type", ["rows"]);
  });
});

describe("listSchema — accept", () => {
  it("valid list with checked true/false/absent parses to exactly the input", () => {
    const input = {
      items: [
        { id: "1", text: "alpha", checked: true },
        { id: "2", text: "beta", checked: false },
        { id: "3", text: "gamma" },
      ],
      variant: "ordered", // passthrough
    };
    const result = listSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(input);
    // the third item never supplied `checked` → it must stay absent
    expect("checked" in result.data.items[2]).toBe(false);
  });
});

describe("listSchema — reject", () => {
  it("empty items (min 1 boundary) → too_small at [items]", () => {
    expectReject(listSchema, { items: [] }, "too_small", ["items"]);
  });

  it("item missing id → invalid_type at [items,0,id]", () => {
    expectReject(listSchema, { items: [{ text: "x" }] }, "invalid_type", ["items", 0, "id"]);
  });

  it("item missing text → invalid_type at [items,0,text]", () => {
    expectReject(listSchema, { items: [{ id: "1" }] }, "invalid_type", ["items", 0, "text"]);
  });

  it("checked wrong type → invalid_type at [items,0,checked]", () => {
    expectReject(
      listSchema,
      { items: [{ id: "1", text: "x", checked: "yes" }] },
      "invalid_type",
      ["items", 0, "checked"],
    );
  });
});

describe("mathSchema — accept", () => {
  it("valid latex parses to exactly the input, passthrough kept", () => {
    const input = { latex: "x^2 + 1", display: true };
    const result = mathSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(input);
  });

  it("a single-character latex is the min-1 boundary and is accepted", () => {
    const result = mathSchema.safeParse({ latex: " " });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ latex: " " });
  });
});

describe("mathSchema — reject", () => {
  it("empty latex (min 1 boundary) → too_small at [latex]", () => {
    expectReject(mathSchema, { latex: "" }, "too_small", ["latex"]);
  });

  it("latex omitted → invalid_type at [latex]", () => {
    expectReject(mathSchema, {}, "invalid_type", ["latex"]);
  });

  it("non-string latex → invalid_type at [latex]", () => {
    expectReject(mathSchema, { latex: 5 }, "invalid_type", ["latex"]);
  });
});
