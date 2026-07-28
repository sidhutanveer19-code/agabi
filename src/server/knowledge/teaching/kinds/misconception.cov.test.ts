import { describe, it, expect } from "vitest";
import { misconceptionKind } from "@/server/knowledge/teaching/kinds/misconception";

/**
 * §13.2 MISCONCEPTION kind. The validator (V2) accepts a payload only when it carries BOTH a
 * non-empty (post-trim) string `misconception` AND a non-empty (post-trim) string `correction`.
 * A named misconception with no correction just teaches the misconception, so it is discarded
 * with MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION. These tests pin the exact static
 * descriptor and drive both legs of the `!has("misconception") || !has("correction")` guard by
 * holding one field valid while breaking exactly the other, from both sides.
 */

const DISCARD = {
  validator: "V2",
  outcome: "discard",
  reason: "MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION",
} as const;

const PASS = { validator: "V2", outcome: "pass" } as const;

// A minimal fully-valid payload; individual tests override one field at a time.
const valid = () => ({ misconception: "heavier objects fall faster", correction: "all objects fall at the same rate in a vacuum" });

describe("misconceptionKind — static descriptor", () => {
  it("declares the MISCONCEPTION kind string", () => {
    expect(misconceptionKind.kind).toBe("MISCONCEPTION");
  });

  it("exposes exactly the corrective capability", () => {
    expect(misconceptionKind.capabilities).toEqual(["corrective"]);
  });

  it("requires exactly misconception and correction payload fields, in that order", () => {
    expect(misconceptionKind.requiredPayloadFields).toEqual(["misconception", "correction"]);
  });

  it("declares a single capability (length pinned so an added capability is caught)", () => {
    expect(misconceptionKind.capabilities).toHaveLength(1);
  });
});

describe("misconceptionKind.validate — accepting valid payloads", () => {
  it("passes V2 when both misconception and correction are present and non-empty", () => {
    expect(misconceptionKind.validate(valid())).toEqual(PASS);
  });

  it("passes with single-character non-whitespace fields (just above the empty boundary)", () => {
    expect(misconceptionKind.validate({ misconception: "a", correction: "b" })).toEqual(PASS);
  });

  it("treats surrounding whitespace as content once trimmed text remains", () => {
    expect(
      misconceptionKind.validate({ misconception: "  m  ", correction: "\t c \n" }),
    ).toEqual(PASS);
  });

  it("ignores unrelated extra payload fields and still passes", () => {
    expect(
      misconceptionKind.validate({ ...valid(), source: "textbook", weight: 5 }),
    ).toEqual(PASS);
  });
});

describe("misconceptionKind.validate — misconception leg", () => {
  it("discards when misconception is missing (undefined)", () => {
    const { misconception, ...rest } = valid();
    void misconception;
    expect(misconceptionKind.validate(rest)).toEqual(DISCARD);
  });

  it("discards when misconception is an empty string", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: "" })).toEqual(DISCARD);
  });

  it("discards when misconception is whitespace only (trim boundary)", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: "   \t\n " })).toEqual(DISCARD);
  });

  it("discards when misconception is a non-string (number)", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: 42 })).toEqual(DISCARD);
  });

  it("discards when misconception is null", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: null })).toEqual(DISCARD);
  });

  it("discards when misconception is boolean false", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: false })).toEqual(DISCARD);
  });

  it("discards when misconception is an object (typeof object, not string)", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: {} })).toEqual(DISCARD);
  });

  it("discards when misconception is an array (typeof object, not string)", () => {
    expect(misconceptionKind.validate({ ...valid(), misconception: ["m"] })).toEqual(DISCARD);
  });
});

describe("misconceptionKind.validate — correction leg", () => {
  it("discards when correction is missing (undefined)", () => {
    const { correction, ...rest } = valid();
    void correction;
    expect(misconceptionKind.validate(rest)).toEqual(DISCARD);
  });

  it("discards when correction is an empty string", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: "" })).toEqual(DISCARD);
  });

  it("discards when correction is whitespace only (trim boundary)", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: " \t \n" })).toEqual(DISCARD);
  });

  it("discards when correction is a non-string (number, including 0)", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: 0 })).toEqual(DISCARD);
  });

  it("discards when correction is null", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: null })).toEqual(DISCARD);
  });

  it("discards when correction is boolean true (non-string truthy)", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: true })).toEqual(DISCARD);
  });

  it("discards when correction is an object (typeof object, not string)", () => {
    expect(misconceptionKind.validate({ ...valid(), correction: {} })).toEqual(DISCARD);
  });
});

describe("misconceptionKind.validate — the || seam (one valid, one broken)", () => {
  // Drive each side of `!has("misconception") || !has("correction")` independently. Any mutant
  // that flips the `||` to `&&` would require BOTH broken to discard, so a single-broken case
  // would wrongly pass — these two tests kill that mutant from both directions.
  it("discards when only misconception is valid and correction is empty", () => {
    expect(misconceptionKind.validate({ misconception: "m", correction: "" })).toEqual(DISCARD);
  });

  it("discards when only correction is valid and misconception is empty", () => {
    expect(misconceptionKind.validate({ misconception: "", correction: "c" })).toEqual(DISCARD);
  });

  it("discards when both fields are invalid at once", () => {
    expect(misconceptionKind.validate({ misconception: "", correction: "" })).toEqual(DISCARD);
  });

  it("discards an entirely empty payload", () => {
    expect(misconceptionKind.validate({})).toEqual(DISCARD);
  });
});

describe("misconceptionKind.validate — result object shape", () => {
  it("a pass result exposes exactly the validator and outcome keys and nothing else", () => {
    const result = misconceptionKind.validate(valid());
    expect(Object.keys(result).sort()).toEqual(["outcome", "validator"]);
    expect(result.validator).toBe("V2");
    expect(result.outcome).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  it("a discard result exposes exactly validator, outcome, and reason keys", () => {
    const result = misconceptionKind.validate({});
    expect(Object.keys(result).sort()).toEqual(["outcome", "reason", "validator"]);
    expect(result.validator).toBe("V2");
    expect(result.outcome).toBe("discard");
    expect(result.reason).toBe("MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION");
  });

  it("carries no detail or securityAlert fields on a discard", () => {
    const result = misconceptionKind.validate({});
    expect(result.detail).toBeUndefined();
    expect(result.securityAlert).toBeUndefined();
  });

  it("returns a fresh result object on each call (no shared mutable singleton)", () => {
    const a = misconceptionKind.validate({});
    const b = misconceptionKind.validate({});
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
