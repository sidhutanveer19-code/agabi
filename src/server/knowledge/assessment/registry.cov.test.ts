import { describe, it, expect } from "vitest";
import { validateItemPayload, classifyByOutcome, ITEM_KINDS } from "@/server/knowledge/assessment/registry";

/**
 * §H1 branch-complete coverage for the assessment-item registry (§10, C3).
 * Every exported symbol, every branch of validateItemPayload, both sides of
 * classifyByOutcome, and the exact shape of every returned ValidationResult.
 */
describe("registry — ITEM_KINDS", () => {
  it("is exactly the seven kinds, in order", () => {
    expect([...ITEM_KINDS]).toEqual(["MCQ", "SHORT", "NUMERIC", "ORDERING", "MATCHING", "ARTIFACT", "CODE"]);
    expect(ITEM_KINDS).toHaveLength(7);
  });

  it("every listed kind is accepted by the validator (no UNKNOWN_ITEM_KIND)", () => {
    for (const kind of ITEM_KINDS) {
      // supply a payload that satisfies each kind's own extra rule
      const payload =
        kind === "MCQ"
          ? { options: [{ text: "a", correct: true }, { text: "b" }] }
          : kind === "NUMERIC"
            ? { answer: 1 }
            : {};
      const result = validateItemPayload(kind, payload);
      expect(result.outcome).toBe("pass");
      expect(result.reason).toBeUndefined();
    }
  });
});

describe("registry — validateItemPayload: unknown kind branch", () => {
  it("discards an unrecognized kind and echoes the exact kind in the reason", () => {
    const result = validateItemPayload("FOO", {});
    expect(result).toEqual({ validator: "V2", outcome: "discard", reason: "UNKNOWN_ITEM_KIND_FOO" });
  });

  it("is case-sensitive — lowercase 'mcq' is unknown", () => {
    expect(validateItemPayload("mcq", { options: [] })).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "UNKNOWN_ITEM_KIND_mcq",
    });
  });

  it("empty-string kind is unknown and interpolates to a bare suffix", () => {
    expect(validateItemPayload("", {}).reason).toBe("UNKNOWN_ITEM_KIND_");
  });
});

describe("registry — validateItemPayload: MCQ branch", () => {
  it("discards when options is missing (not an array)", () => {
    expect(validateItemPayload("MCQ", {})).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "MCQ_NEEDS_AT_LEAST_TWO_OPTIONS",
    });
  });

  it("discards when options is a non-array value", () => {
    expect(validateItemPayload("MCQ", { options: "a,b" }).reason).toBe("MCQ_NEEDS_AT_LEAST_TWO_OPTIONS");
    expect(validateItemPayload("MCQ", { options: { 0: "a", 1: "b" } }).reason).toBe("MCQ_NEEDS_AT_LEAST_TWO_OPTIONS");
    expect(validateItemPayload("MCQ", { options: 2 }).reason).toBe("MCQ_NEEDS_AT_LEAST_TWO_OPTIONS");
  });

  it("discards an empty options array (length 0)", () => {
    expect(validateItemPayload("MCQ", { options: [] }).reason).toBe("MCQ_NEEDS_AT_LEAST_TWO_OPTIONS");
  });

  it("discards a single-option array (boundary length 1 < 2)", () => {
    expect(validateItemPayload("MCQ", { options: [{ text: "a", correct: true }] }).reason).toBe(
      "MCQ_NEEDS_AT_LEAST_TWO_OPTIONS",
    );
  });

  it("with two+ options but zero correct, needs exactly one correct", () => {
    const result = validateItemPayload("MCQ", { options: [{ text: "a" }, { text: "b" }] });
    expect(result).toEqual({ validator: "V2", outcome: "discard", reason: "MCQ_NEEDS_EXACTLY_ONE_CORRECT" });
  });

  it("with two correct options, needs exactly one correct", () => {
    const result = validateItemPayload("MCQ", {
      options: [{ text: "a", correct: true }, { text: "b", correct: true }],
    });
    expect(result.reason).toBe("MCQ_NEEDS_EXACTLY_ONE_CORRECT");
    expect(result.outcome).toBe("discard");
  });

  it("counts correct strictly by === true (a truthy non-true value is NOT correct)", () => {
    // correct: "true" and correct: 1 are truthy but not === true → zero counted correct → discard
    const result = validateItemPayload("MCQ", {
      options: [{ text: "a", correct: "true" }, { text: "b", correct: 1 }],
    });
    expect(result.reason).toBe("MCQ_NEEDS_EXACTLY_ONE_CORRECT");
  });

  it("correct: false does not count toward the correct tally", () => {
    const result = validateItemPayload("MCQ", {
      options: [{ text: "a", correct: false }, { text: "b", correct: true }],
    });
    expect(result).toEqual({ validator: "V2", outcome: "pass" });
  });

  it("passes with exactly one correct among two options (boundary length 2)", () => {
    const result = validateItemPayload("MCQ", {
      options: [{ text: "a", correct: true }, { text: "b" }],
    });
    expect(result).toEqual({ validator: "V2", outcome: "pass" });
    expect(result.reason).toBeUndefined();
  });

  it("passes with exactly one correct among three options", () => {
    const result = validateItemPayload("MCQ", {
      options: [{ text: "a", correct: true }, { text: "b" }, { text: "c" }],
    });
    expect(result.outcome).toBe("pass");
    expect(result.validator).toBe("V2");
  });
});

describe("registry — validateItemPayload: NUMERIC branch", () => {
  it("discards when answer is absent", () => {
    expect(validateItemPayload("NUMERIC", {})).toEqual({
      validator: "V2",
      outcome: "discard",
      reason: "NUMERIC_NEEDS_ANSWER",
    });
  });

  it("discards when answer is a numeric string (typeof, not coercion)", () => {
    expect(validateItemPayload("NUMERIC", { answer: "5" }).reason).toBe("NUMERIC_NEEDS_ANSWER");
  });

  it("discards when answer is null (typeof null === 'object')", () => {
    expect(validateItemPayload("NUMERIC", { answer: null }).reason).toBe("NUMERIC_NEEDS_ANSWER");
  });

  it("passes with a real number answer", () => {
    expect(validateItemPayload("NUMERIC", { answer: 42 })).toEqual({ validator: "V2", outcome: "pass" });
  });

  it("passes with answer 0 (falsy but a number — locks typeof over truthiness)", () => {
    expect(validateItemPayload("NUMERIC", { answer: 0 }).outcome).toBe("pass");
  });

  it("passes with answer NaN (typeof NaN === 'number')", () => {
    expect(validateItemPayload("NUMERIC", { answer: NaN }).outcome).toBe("pass");
  });
});

describe("registry — validateItemPayload: fall-through kinds", () => {
  it.each(["SHORT", "ORDERING", "MATCHING", "ARTIFACT", "CODE"])(
    "%s passes regardless of payload contents",
    (kind) => {
      expect(validateItemPayload(kind, {})).toEqual({ validator: "V2", outcome: "pass" });
    },
  );

  it("a non-MCQ kind is not subject to the MCQ options rule", () => {
    // SHORT with an invalid-for-MCQ options field still passes — the MCQ branch is skipped
    expect(validateItemPayload("SHORT", { options: [] }).outcome).toBe("pass");
  });

  it("a non-NUMERIC kind is not subject to the NUMERIC answer rule", () => {
    // ORDERING with a string answer still passes — the NUMERIC branch is skipped
    expect(validateItemPayload("ORDERING", { answer: "not-a-number" }).outcome).toBe("pass");
  });
});

describe("registry — classifyByOutcome (F5, §13.2)", () => {
  it("true → AssessmentItem (recorded as evidence)", () => {
    expect(classifyByOutcome(true)).toBe("AssessmentItem");
  });

  it("false → Exercise (practice, never scored)", () => {
    expect(classifyByOutcome(false)).toBe("Exercise");
  });
});
