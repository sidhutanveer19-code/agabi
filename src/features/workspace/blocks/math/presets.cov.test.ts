import { describe, it, expect } from "vitest";
import { Sigma, Calculator, Superscript, Radical } from "lucide-react";
import {
  mathSchema,
  PRESETS,
  BY_TYPE,
  type MathData,
  type MathPreset,
} from "@/features/workspace/blocks/math/presets";

/**
 * presets.ts is a katex-free data module: a Zod schema for a math block's data,
 * a fixed table of four presets, and a `type → preset` index. It has no
 * branches of its own, so mutation survival here comes down to pinning EVERY
 * literal (each type/label/sample string, each display flag, each width/height)
 * and the exact schema + index behavior. The assertions below are written so
 * that changing any single field, dropping a preset, or breaking the map's
 * key/value shape flips a concrete expectation.
 */

// The canonical, fully-specified expectation for every preset, in order. Any
// per-field mutation (string → "", boolean flip, number tweak, object → {}) is
// caught by the exact deep-equality + field-level checks below.
const EXPECTED: ReadonlyArray<MathPreset> = [
  { type: "formula", label: "Formula", icon: Sigma, display: true, sample: "a^2 + b^2 = c^2", defaultSize: { w: 360, h: 96 } },
  { type: "equation", label: "Equation", icon: Calculator, display: true, sample: "E = mc^2", defaultSize: { w: 360, h: 96 } },
  { type: "inline-equation", label: "Inline Equation", icon: Superscript, display: false, sample: "x^2 + 1", defaultSize: { w: 220, h: 56 } },
  { type: "display-equation", label: "Display Equation", icon: Radical, display: true, sample: "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", defaultSize: { w: 420, h: 110 } },
];

describe("math/presets — mathSchema", () => {
  it("parses a valid { latex: string } payload and returns exactly that shape", () => {
    const input = { latex: "a^2 + b^2 = c^2" };
    const parsed = mathSchema.parse(input);
    expect(parsed).toEqual({ latex: "a^2 + b^2 = c^2" });
    // Real value round-trips, not just a truthy pass.
    expect((parsed as MathData).latex).toBe("a^2 + b^2 = c^2");
  });

  it("accepts an empty-string latex (z.string permits '', it is not .min(1))", () => {
    const res = mathSchema.safeParse({ latex: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.latex).toBe("");
  });

  it("strips unknown keys, keeping only latex (default object stripping)", () => {
    const res = mathSchema.safeParse({ latex: "x", extra: 42, nested: { a: 1 } });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ latex: "x" });
      expect(Object.keys(res.data)).toEqual(["latex"]);
      expect("extra" in res.data).toBe(false);
    }
  });

  it("rejects a missing latex field", () => {
    const res = mathSchema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      // The failure is specifically about the `latex` path.
      expect(res.error.issues[0]?.path).toEqual(["latex"]);
    }
  });

  it("rejects a non-string latex (number)", () => {
    const res = mathSchema.safeParse({ latex: 123 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["latex"]);
  });

  it("rejects a null latex", () => {
    expect(mathSchema.safeParse({ latex: null }).success).toBe(false);
  });

  it("rejects an undefined latex", () => {
    expect(mathSchema.safeParse({ latex: undefined }).success).toBe(false);
  });

  it("rejects a non-object payload (string / null / undefined)", () => {
    expect(mathSchema.safeParse("nope").success).toBe(false);
    expect(mathSchema.safeParse(null).success).toBe(false);
    expect(mathSchema.safeParse(undefined).success).toBe(false);
    expect(mathSchema.safeParse(7).success).toBe(false);
  });

  it("throws (not returns) on .parse of invalid input", () => {
    expect(() => mathSchema.parse({ latex: 1 })).toThrow();
  });
});

describe("math/presets — PRESETS table", () => {
  it("contains exactly four presets", () => {
    expect(PRESETS).toHaveLength(4);
  });

  it("lists the four types in declaration order", () => {
    expect(PRESETS.map((p) => p.type)).toEqual([
      "formula",
      "equation",
      "inline-equation",
      "display-equation",
    ]);
  });

  it("has fully unique type keys (no two presets share a type)", () => {
    const types = PRESETS.map((p) => p.type);
    expect(new Set(types).size).toBe(types.length);
  });

  // Per-index, per-field pinning. `toEqual` on the whole object also guards
  // against an extra/missing field, and the icon identity check is a separate
  // strict-equality assertion because lucide components must be the exact import.
  EXPECTED.forEach((expected, i) => {
    describe(`PRESETS[${i}] — ${expected.type}`, () => {
      const p = PRESETS[i];

      it("matches the expected shape exactly", () => {
        expect(p).toEqual(expected);
      });

      it("pins type, label and sample strings", () => {
        expect(p.type).toBe(expected.type);
        expect(p.label).toBe(expected.label);
        expect(p.sample).toBe(expected.sample);
      });

      it("pins the display flag", () => {
        expect(p.display).toBe(expected.display);
        expect(typeof p.display).toBe("boolean");
      });

      it("pins the defaultSize width and height", () => {
        expect(p.defaultSize).toEqual(expected.defaultSize);
        expect(p.defaultSize.w).toBe(expected.defaultSize.w);
        expect(p.defaultSize.h).toBe(expected.defaultSize.h);
      });

      it("uses the exact lucide icon component (reference identity)", () => {
        expect(p.icon).toBe(expected.icon);
      });
    });
  });

  it("distinguishes the display flags: only inline-equation is hidden", () => {
    // Pins the true/false split precisely so flipping any one flag fails.
    expect(BY_TYPE.get("formula")?.display).toBe(true);
    expect(BY_TYPE.get("equation")?.display).toBe(true);
    expect(BY_TYPE.get("inline-equation")?.display).toBe(false);
    expect(BY_TYPE.get("display-equation")?.display).toBe(true);
    expect(PRESETS.filter((p) => p.display).map((p) => p.type)).toEqual([
      "formula",
      "equation",
      "display-equation",
    ]);
    expect(PRESETS.filter((p) => !p.display)).toHaveLength(1);
  });

  it("uses four distinct icon components", () => {
    const icons = PRESETS.map((p) => p.icon);
    expect(new Set(icons).size).toBe(4);
    expect(icons).toEqual([Sigma, Calculator, Superscript, Radical]);
  });

  it("every preset's sample validates against the block schema round-trip", () => {
    // The sample is what the insert palette seeds a new math block with, so it
    // must be a legal MathData latex string.
    for (const p of PRESETS) {
      const res = mathSchema.safeParse({ latex: p.sample });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.latex).toBe(p.sample);
    }
  });
});

describe("math/presets — BY_TYPE index", () => {
  it("is a Map with one entry per preset", () => {
    expect(BY_TYPE).toBeInstanceOf(Map);
    expect(BY_TYPE.size).toBe(4);
    expect(BY_TYPE.size).toBe(PRESETS.length);
  });

  it("keys by preset.type and stores the identical preset object (not a copy)", () => {
    for (const preset of PRESETS) {
      // Strict identity: the map value is the very same object from PRESETS,
      // which kills a mutation that swapped the [key, value] pair shape.
      expect(BY_TYPE.get(preset.type)).toBe(preset);
    }
  });

  it("exposes exactly the four known keys", () => {
    expect([...BY_TYPE.keys()]).toEqual([
      "formula",
      "equation",
      "inline-equation",
      "display-equation",
    ]);
  });

  it("returns undefined for an unknown type", () => {
    expect(BY_TYPE.get("nope")).toBeUndefined();
    expect(BY_TYPE.get("")).toBeUndefined();
    expect(BY_TYPE.has("paragraph")).toBe(false);
  });

  it("resolves each type back to a preset whose own type matches the key", () => {
    for (const type of ["formula", "equation", "inline-equation", "display-equation"]) {
      expect(BY_TYPE.get(type)?.type).toBe(type);
    }
  });
});
