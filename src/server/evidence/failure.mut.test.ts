import { describe, it, expect } from "vitest";
import { classify } from "@/server/evidence/failure";

/**
 * Mutation-killing tests for classify().
 *
 * Trick used throughout the L16 cases: the function's DEFAULT return is also
 * "transient", so a plain `{ code }` object yields "transient" whether the first
 * `if` fires or falls through — that cannot distinguish the mutants. But if the
 * error is ALSO a TypeError, falling past the first `if` reaches line 22 and
 * returns "permanent". So "TypeError carrying a transient code → transient"
 * pins that the first branch actually fires for that exact code.
 */
describe("failure.classify — mutation kills", () => {
  // L13:16 OptionalChaining (err?.code -> err.code)
  // L13:29 OptionalChaining (err?.errorCode -> err.errorCode)
  // With null/undefined input, dropping the optional chaining throws instead of
  // returning a value, so pinning the real return value kills both.
  it("null input is classified transient without throwing (optional chaining on both operands)", () => {
    expect(classify(null)).toBe("transient");
  });
  it("undefined input is classified transient without throwing (optional chaining)", () => {
    expect(classify(undefined)).toBe("transient");
  });

  // The `?? err?.errorCode` right operand must actually be reached and read:
  // when `code` is absent but `errorCode` is a permanent-family code, result flips.
  it("uses errorCode when code is absent (?? evaluates the right operand)", () => {
    expect(classify({ errorCode: "P2000" })).toBe("permanent");
    expect(classify({ errorCode: "P1001" })).toBe("transient");
  });
  it("code wins over errorCode when both are present (?? short-circuits on left)", () => {
    // left = P1001 (transient) must win over right = P2000 (permanent)
    expect(classify({ code: "P1001", errorCode: "P2000" })).toBe("transient");
  });

  // ---- L16 whole-condition + per-operand mutants ----
  // For each transient code: a TypeError carrying that code must still be
  // "transient". If ANY L16 mutant (ConditionalExpression->false, the three
  // LogicalOperator rewrites, per-operand ->false, or StringLiteral->"") makes
  // the first `if` evaluate false for this code, control falls to the
  // `instanceof TypeError` branch and returns "permanent" — failing the assert.
  const transientCodes = ["P1001", "P1002", "P1008", "P2024"] as const;
  for (const code of transientCodes) {
    it(`TypeError carrying code ${code} is still transient (first branch fires for exactly this code)`, () => {
      const e = new TypeError("io glitch") as TypeError & { code?: string };
      e.code = code;
      expect(classify(e)).toBe("transient");
    });

    it(`plain object with code ${code} is transient`, () => {
      expect(classify({ code })).toBe("transient");
    });
  }

  // Guard the StringLiteral mutants from the other direction: an empty-string
  // code (what `code === ""` would newly match) must NOT be treated as transient
  // via the first branch. Empty string is unknown -> default transient, but a
  // TypeError with code "" must be permanent (proves "" is not a P1xxx literal).
  it('TypeError with empty-string code is permanent (empty string is not a transient literal)', () => {
    const e = new TypeError("x") as TypeError & { code?: string };
    e.code = "";
    expect(classify(e)).toBe("permanent");
  });

  // A non-error object whose code is NOT any listed literal falls through to the
  // default: transient. Pins that the P2024 operand isn't spuriously true and the
  // default path returns exactly "transient".
  it("unknown non-error code falls through to transient default", () => {
    expect(classify({ code: "P9999" })).toBe("transient");
  });

  // Both sides of the permanent branch, so the L16 fall-through target is real.
  it("permanent-family codes are permanent (fall-through target is meaningful)", () => {
    for (const code of ["P2000", "P2006", "P2007"]) {
      expect(classify({ code })).toBe("permanent");
    }
  });
  it("TypeError / RangeError with no code are permanent", () => {
    expect(classify(new TypeError("BigInt"))).toBe("permanent");
    expect(classify(new RangeError("range"))).toBe("permanent");
  });
});
