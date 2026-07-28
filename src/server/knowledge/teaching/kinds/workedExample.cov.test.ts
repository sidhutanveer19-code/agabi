import { describe, it, expect } from "vitest";
import { workedExampleKind } from "@/server/knowledge/teaching/kinds/workedExample";

/**
 * §13.2 WORKED_EXAMPLE kind. The validator (V2) accepts a payload only when it carries a
 * non-empty string `problem`, a non-empty string `answer`, and a non-empty array `steps`.
 * Every other shape is discarded with WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER. These tests
 * pin the exact static descriptor and drive each independent leg of the `!problem || !answer
 * || !steps` guard by holding two fields valid while breaking exactly one.
 */

const DISCARD = {
  validator: "V2",
  outcome: "discard",
  reason: "WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER",
} as const;

const PASS = { validator: "V2", outcome: "pass" } as const;

// A minimal fully-valid payload; individual tests override one field at a time.
const valid = () => ({ problem: "2 + 2 = ?", steps: ["add the digits"], answer: "4" });

describe("workedExampleKind — static descriptor", () => {
  it("declares the WORKED_EXAMPLE kind string", () => {
    expect(workedExampleKind.kind).toBe("WORKED_EXAMPLE");
  });

  it("exposes exactly the demonstrable capability", () => {
    expect(workedExampleKind.capabilities).toEqual(["demonstrable"]);
  });

  it("requires exactly problem, steps, and answer payload fields", () => {
    expect(workedExampleKind.requiredPayloadFields).toEqual(["problem", "steps", "answer"]);
  });
});

describe("workedExampleKind.validate — accepting valid payloads", () => {
  it("passes V2 when problem, steps, and answer are all present and non-empty", () => {
    expect(workedExampleKind.validate(valid())).toEqual(PASS);
  });

  it("passes with a multi-step example (steps length > 1)", () => {
    expect(
      workedExampleKind.validate({
        problem: "solve for x",
        steps: ["subtract 3", "divide by 2"],
        answer: "x = 4",
      }),
    ).toEqual(PASS);
  });

  it("does not inspect step contents — a single falsy element still counts as one step", () => {
    // length is 1 (> 0); the validator only checks array-ness and length, not element truthiness.
    expect(
      workedExampleKind.validate({ problem: "p", steps: [null], answer: "a" }),
    ).toEqual(PASS);
  });

  it("treats surrounding whitespace as content once trimmed text remains", () => {
    expect(
      workedExampleKind.validate({ problem: "  p  ", steps: ["s"], answer: "  a  " }),
    ).toEqual(PASS);
  });
});

describe("workedExampleKind.validate — problem leg", () => {
  it("discards when problem is missing (undefined)", () => {
    const { problem, ...rest } = valid();
    void problem;
    expect(workedExampleKind.validate(rest)).toEqual(DISCARD);
  });

  it("discards when problem is an empty string", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: "" })).toEqual(DISCARD);
  });

  it("discards when problem is whitespace only (trim boundary)", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: "   " })).toEqual(DISCARD);
  });

  it("discards when problem is a non-string (number)", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: 42 })).toEqual(DISCARD);
  });

  it("discards when problem is null", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: null })).toEqual(DISCARD);
  });
});

describe("workedExampleKind.validate — answer leg", () => {
  it("discards when answer is missing (undefined)", () => {
    const { answer, ...rest } = valid();
    void answer;
    expect(workedExampleKind.validate(rest)).toEqual(DISCARD);
  });

  it("discards when answer is an empty string", () => {
    expect(workedExampleKind.validate({ ...valid(), answer: "" })).toEqual(DISCARD);
  });

  it("discards when answer is whitespace only (trim boundary)", () => {
    expect(workedExampleKind.validate({ ...valid(), answer: "\t\n " })).toEqual(DISCARD);
  });

  it("discards when answer is a non-string (boolean)", () => {
    expect(workedExampleKind.validate({ ...valid(), answer: true })).toEqual(DISCARD);
  });
});

describe("workedExampleKind.validate — steps leg", () => {
  it("discards when steps is missing (undefined)", () => {
    const { steps, ...rest } = valid();
    void steps;
    expect(workedExampleKind.validate(rest)).toEqual(DISCARD);
  });

  it("discards when steps is an empty array (length boundary)", () => {
    expect(workedExampleKind.validate({ ...valid(), steps: [] })).toEqual(DISCARD);
  });

  it("discards when steps is a non-array truthy value (string)", () => {
    expect(workedExampleKind.validate({ ...valid(), steps: "add the digits" })).toEqual(DISCARD);
  });

  it("discards when steps is null", () => {
    expect(workedExampleKind.validate({ ...valid(), steps: null })).toEqual(DISCARD);
  });
});

describe("workedExampleKind.validate — multiple invalid fields", () => {
  it("discards when every field is invalid at once", () => {
    expect(
      workedExampleKind.validate({ problem: "", steps: [], answer: "" }),
    ).toEqual(DISCARD);
  });

  it("discards an entirely empty payload", () => {
    expect(workedExampleKind.validate({})).toEqual(DISCARD);
  });

  it("returns a discard result carrying no detail or securityAlert fields", () => {
    const result = workedExampleKind.validate({});
    expect(result.detail).toBeUndefined();
    expect(result.securityAlert).toBeUndefined();
  });

  // Pin each pairwise "two invalid, one valid" combination. Any mutant that turns one of the two
  // `||` seams into `&&` collapses one of these to a false condition → wrong pass. Holding exactly
  // one field valid at a time exercises both seams from the opposite side of the single-leg tests.
  it("discards when problem and answer are invalid but steps is valid", () => {
    expect(workedExampleKind.validate({ problem: "", steps: ["s"], answer: "" })).toEqual(DISCARD);
  });

  it("discards when problem and steps are invalid but answer is valid", () => {
    expect(workedExampleKind.validate({ problem: "", steps: [], answer: "a" })).toEqual(DISCARD);
  });

  it("discards when answer and steps are invalid but problem is valid", () => {
    expect(workedExampleKind.validate({ problem: "p", steps: [], answer: "" })).toEqual(DISCARD);
  });
});

describe("workedExampleKind.validate — array-ness of steps", () => {
  // Array.isArray must be the actual guard, not a `.length` truthiness check: an array-LIKE object
  // has a positive `.length` yet is not an Array. This is the only shape that distinguishes the two.
  it("discards an array-like object with a positive length (not a real Array)", () => {
    expect(
      workedExampleKind.validate({ ...valid(), steps: { length: 1, 0: "s" } }),
    ).toEqual(DISCARD);
  });

  it("discards when steps is a number (non-array primitive)", () => {
    expect(workedExampleKind.validate({ ...valid(), steps: 1 })).toEqual(DISCARD);
  });

  it("discards when steps is a boolean (non-array primitive)", () => {
    expect(workedExampleKind.validate({ ...valid(), steps: true })).toEqual(DISCARD);
  });

  it("discards when steps is undefined-typed via missing but other fields valid", () => {
    expect(workedExampleKind.validate({ problem: "p", answer: "a" })).toEqual(DISCARD);
  });

  it("passes with multiple truthy string steps (length well above the 0 boundary)", () => {
    expect(
      workedExampleKind.validate({ problem: "p", steps: ["one", "two", "three"], answer: "a" }),
    ).toEqual(PASS);
  });

  it("passes when a step element is an empty string — element content is never inspected", () => {
    expect(workedExampleKind.validate({ problem: "p", steps: [""], answer: "a" })).toEqual(PASS);
  });
});

describe("workedExampleKind.validate — non-string problem/answer shapes", () => {
  it("discards when problem is an object (typeof object, not string)", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: {} })).toEqual(DISCARD);
  });

  it("discards when problem is an array (typeof object, not string)", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: ["p"] })).toEqual(DISCARD);
  });

  it("discards when answer is null", () => {
    expect(workedExampleKind.validate({ ...valid(), answer: null })).toEqual(DISCARD);
  });

  it("discards when answer is a number, including 0", () => {
    expect(workedExampleKind.validate({ ...valid(), answer: 0 })).toEqual(DISCARD);
  });

  it("discards when problem is a boolean false", () => {
    expect(workedExampleKind.validate({ ...valid(), problem: false })).toEqual(DISCARD);
  });
});

describe("workedExampleKind.validate — result object shape", () => {
  it("a pass result exposes exactly the validator and outcome keys and nothing else", () => {
    const result = workedExampleKind.validate(valid());
    expect(Object.keys(result).sort()).toEqual(["outcome", "validator"]);
    expect(result.validator).toBe("V2");
    expect(result.outcome).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  it("a discard result exposes exactly validator, outcome, and reason keys", () => {
    const result = workedExampleKind.validate({});
    expect(Object.keys(result).sort()).toEqual(["outcome", "reason", "validator"]);
    expect(result.reason).toBe("WORKED_EXAMPLE_NEEDS_PROBLEM_STEPS_ANSWER");
  });

  it("returns a fresh result object on each call (no shared mutable singleton)", () => {
    const a = workedExampleKind.validate({});
    const b = workedExampleKind.validate({});
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("ignores unrelated extra payload fields and still passes", () => {
    expect(
      workedExampleKind.validate({ ...valid(), hint: "irrelevant", difficulty: 3 }),
    ).toEqual(PASS);
  });
});
