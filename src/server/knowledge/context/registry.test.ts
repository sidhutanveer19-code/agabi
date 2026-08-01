import { describe, it, expect } from "vitest";
import { normaliseValue, type DimensionValueType } from "@/server/knowledge/context/registry";

/**
 * normaliseValue — the per-type context normaliser that makes canonical hashing
 * deterministic across value spellings (§14.2). This module is PURE: no prisma, no
 * network, no clock (the date branch derives everything from the passed value, never
 * `Date.now()`), so there is NO I/O edge to fake — every assertion below exercises the
 * REAL logic with the REAL result named, including hostile/edge input.
 *
 * Branch map that MUST be covered:
 *   iso3166/iso639            → String→trim→toUpperCase (string + non-string)
 *   date · instanceof Date    → true (Date value) AND false (string value)
 *   date · Number.isNaN       → true (invalid) AND false (valid)
 *   range · value && object && "min" in v && "max" in v → each of the 4 short-circuits
 *   enum/string/default ternary typeof==="string" → true (trim) AND false (passthrough)
 *   default                   → an unregistered valueType falls through to string rules
 */

// A cast helper so an UNREGISTERED valueType (the `default` arm) is tsc-clean under strict.
const unknownType = (t: string): DimensionValueType => t as unknown as DimensionValueType;

describe("normaliseValue — iso3166 / iso639 (shared uppercase-trim arm)", () => {
  it("iso3166 trims surrounding whitespace and uppercases", () => {
    expect(normaliseValue("iso3166", "  in  ")).toBe("IN");
  });

  it("iso3166 is idempotent on an already-canonical code", () => {
    expect(normaliseValue("iso3166", "IN")).toBe("IN");
  });

  it("iso3166 uppercases a mixed-case code", () => {
    expect(normaliseValue("iso3166", "Us")).toBe("US");
  });

  it("iso639 takes the SAME arm — '  en ' → 'EN'", () => {
    expect(normaliseValue("iso639", "  en ")).toBe("EN");
  });

  it("non-string is coerced via String() then trimmed+uppercased (number 840 → '840')", () => {
    expect(normaliseValue("iso3166", 840)).toBe("840");
  });

  it("null coerces to the literal string 'NULL' (String(null) → 'null' → uppercase)", () => {
    expect(normaliseValue("iso3166", null)).toBe("NULL");
  });

  it("DETERMINISM PROPERTY: 'in' and 'IN' collapse to one canonical value", () => {
    const a = normaliseValue("iso3166", "in");
    const b = normaliseValue("iso3166", "IN");
    expect(a).toBe("IN");
    expect(b).toBe("IN");
    expect(a).toBe(b);
  });
});

describe("normaliseValue — date (UTC-midnight truncation)", () => {
  it("a Date INSTANCE (instanceof=true, valid) truncates time-of-day to UTC midnight ISO", () => {
    // instanceof Date → true branch; getTime() not NaN → false branch of isNaN.
    expect(normaliseValue("date", new Date("2020-06-15T13:45:30.500Z"))).toBe(
      "2020-06-15T00:00:00.000Z",
    );
  });

  it("a date STRING (instanceof=false) is parsed then truncated to UTC midnight", () => {
    expect(normaliseValue("date", "2020-06-15")).toBe("2020-06-15T00:00:00.000Z");
  });

  it("late-in-day UTC keeps the SAME UTC day (23:59:59Z on the 31st → 31st midnight)", () => {
    expect(normaliseValue("date", "2020-12-31T23:59:59Z")).toBe("2020-12-31T00:00:00.000Z");
  });

  it("a Date already at UTC midnight is unchanged", () => {
    expect(normaliseValue("date", new Date("2020-01-01T00:00:00Z"))).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });

  it("an UNPARSEABLE string does NOT fabricate a date — echoes the raw string back", () => {
    // instanceof=false, isNaN(getTime())=true → return String(value)
    expect(normaliseValue("date", "not-a-date")).toBe("not-a-date");
  });

  it("an INVALID Date instance (instanceof=true AND isNaN=true) → String(value) = 'Invalid Date'", () => {
    expect(normaliseValue("date", new Date(NaN))).toBe("Invalid Date");
  });
});

describe("normaliseValue — range ({min,max} → two-tuple; else passthrough)", () => {
  it("{min,max} object → a NEW [min, max] tuple", () => {
    expect(normaliseValue("range", { min: 0, max: 100 })).toEqual([0, 100]);
  });

  it("negative bounds survive intact in the tuple", () => {
    expect(normaliseValue("range", { min: -5, max: 5 })).toEqual([-5, 5]);
  });

  it("falsy bounds are kept — {min:0,max:0} → [0,0] (KEY presence, not truthiness)", () => {
    expect(normaliseValue("range", { min: 0, max: 0 })).toEqual([0, 0]);
  });

  it("null short-circuits at `value &&` and passes through as null", () => {
    expect(normaliseValue("range", null)).toBe(null);
  });

  it("undefined short-circuits at `value &&` and passes through as undefined", () => {
    expect(normaliseValue("range", undefined)).toBe(undefined);
  });

  it("a non-object (string) short-circuits at typeof and passes through unchanged", () => {
    expect(normaliseValue("range", "10-20")).toBe("10-20");
  });

  it("a number short-circuits at typeof and passes through unchanged", () => {
    expect(normaliseValue("range", 5)).toBe(5);
  });

  it("an object MISSING 'min' passes through as-is (same reference, NOT a tuple)", () => {
    const v = { max: 9 };
    expect(normaliseValue("range", v)).toBe(v);
  });

  it("an object with 'min' but MISSING 'max' passes through as-is (same reference)", () => {
    const v = { min: 1 };
    expect(normaliseValue("range", v)).toBe(v);
  });
});

describe("normaliseValue — enum / string / default (trim-if-string arm)", () => {
  it("enum string is trimmed", () => {
    expect(normaliseValue("enum", "  active  ")).toBe("active");
  });

  it("enum non-string (number) passes through unchanged", () => {
    expect(normaliseValue("enum", 42)).toBe(42);
  });

  it("string type is trimmed", () => {
    expect(normaliseValue("string", "  hi  ")).toBe("hi");
  });

  it("string type non-string (object) passes through as the SAME reference", () => {
    const v = { a: 1 };
    expect(normaliseValue("string", v)).toBe(v);
  });

  it("string type with null passes through as null (typeof null !== 'string')", () => {
    expect(normaliseValue("string", null)).toBe(null);
  });

  it("an UNREGISTERED valueType hits `default` and trims a string", () => {
    expect(normaliseValue(unknownType("phone"), "  x  ")).toBe("x");
  });

  it("an UNREGISTERED valueType with a non-string passes it through unchanged", () => {
    expect(normaliseValue(unknownType("phone"), 99)).toBe(99);
  });
});

describe("normaliseValue — totality & purity", () => {
  it("is pure: identical input yields identical output on repeat calls", () => {
    expect(normaliseValue("iso639", "  fr ")).toBe(normaliseValue("iso639", "  fr "));
    expect(normaliseValue("enum", "  x ")).toBe(normaliseValue("enum", "  x "));
  });

  it("never throws for empty string across every valueType", () => {
    expect(normaliseValue("iso3166", "")).toBe("");
    expect(normaliseValue("date", "")).toBe(""); // new Date("") is Invalid → echo ""
    expect(normaliseValue("range", "")).toBe("");
    expect(normaliseValue("enum", "")).toBe("");
    expect(normaliseValue("string", "")).toBe("");
  });
});
