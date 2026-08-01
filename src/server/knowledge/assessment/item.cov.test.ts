import { describe, it, expect } from "vitest";
import { buildItem, diagnosedMisconception, type ItemInput } from "@/server/knowledge/assessment/item";
import { validateItemPayload } from "@/server/knowledge/assessment/registry";
import type { AssessmentItem } from "@/server/knowledge/types";

/**
 * Branch/behavior coverage for the assessment-item builder (§10, M9) and the MCQ
 * distractor diagnostic (§13.2). Real module, real mintId/registry calls — no mocks:
 * the only "external" is the in-process id generator, which is genuine logic to exercise.
 */

const VALID_MCQ: ItemInput = {
  kind: "MCQ",
  prompt: "What does a plant do with sunlight?",
  payload: {
    options: [
      { text: "converts it", correct: true },
      { text: "eats it", diagnosesMisconception: "plants eat sunlight" },
    ],
  },
  contextId: "ctx-1",
};

describe("buildItem (§10, M9)", () => {
  it("constructs an item MACHINE_PROPOSED at v1 with no supersedes (ADR-2)", () => {
    const { item } = buildItem(VALID_MCQ);
    expect(item.trustLevel).toBe("MACHINE_PROPOSED");
    expect(item.version).toBe(1);
    expect(item.supersedes).toBeNull();
  });

  it("passes prompt, kind, contextId and the SAME payload object through unchanged", () => {
    const { item } = buildItem(VALID_MCQ);
    expect(item.kind).toBe("MCQ");
    expect(item.prompt).toBe("What does a plant do with sunlight?");
    expect(item.contextId).toBe("ctx-1");
    // identity, not a copy — the builder must not clone/rewrite the payload
    expect(item.payload).toBe(VALID_MCQ.payload);
  });

  it("mints a fresh opaque id of the expected shape, unique per call", () => {
    const a = buildItem(VALID_MCQ).item;
    const b = buildItem(VALID_MCQ).item;
    expect(a.id).toMatch(/^[0-9a-z]{9}[0-9a-f]{16}$/);
    expect(a.id).toHaveLength(25);
    expect(a.id).not.toBe(b.id); // two builds never collide (random suffix)
  });

  it("defaults scope to PUBLIC when scope is omitted", () => {
    const { item } = buildItem({ kind: "SHORT", prompt: "Define osmosis", payload: {}, contextId: "ctx" });
    expect(item.scope).toBe("PUBLIC");
  });

  it("honours an explicit PUBLIC scope", () => {
    const { item } = buildItem({ ...VALID_MCQ, scope: "PUBLIC" });
    expect(item.scope).toBe("PUBLIC");
  });

  it("honours an explicit tenant scope instead of overriding it with PUBLIC", () => {
    const { item } = buildItem({ ...VALID_MCQ, scope: "tenant:acme" });
    expect(item.scope).toBe("tenant:acme");
  });

  it("returns the registry's PASS validation for a well-formed MCQ", () => {
    const { validation } = buildItem(VALID_MCQ);
    expect(validation).toEqual(validateItemPayload("MCQ", VALID_MCQ.payload));
    expect(validation.validator).toBe("V2");
    expect(validation.outcome).toBe("pass");
  });

  it("still builds the item but surfaces a DISCARD validation for an unknown kind", () => {
    const { item, validation } = buildItem({ kind: "ESSAY", prompt: "p", payload: {}, contextId: "ctx" });
    // buildItem does not gate on validation — the item is always constructed…
    expect(item.kind).toBe("ESSAY");
    expect(item.trustLevel).toBe("MACHINE_PROPOSED");
    // …and the caller gets the honest rejection reason to act on
    expect(validation.outcome).toBe("discard");
    expect(validation.reason).toBe("UNKNOWN_ITEM_KIND_ESSAY");
  });

  it("propagates a NUMERIC discard when the answer is missing", () => {
    const { validation } = buildItem({ kind: "NUMERIC", prompt: "2+2?", payload: {}, contextId: "ctx" });
    expect(validation.outcome).toBe("discard");
    expect(validation.reason).toBe("NUMERIC_NEEDS_ANSWER");
  });
});

describe("diagnosedMisconception (§13.2)", () => {
  const withOptions = (options: unknown): AssessmentItem => ({
    id: "i",
    kind: "MCQ",
    prompt: "p",
    payload: { options },
    contextId: "ctx",
    scope: "PUBLIC",
    trustLevel: "MACHINE_PROPOSED",
    version: 1,
    supersedes: null,
  });

  it("returns the misconception string for a distractor that carries one", () => {
    const item = buildItem(VALID_MCQ).item;
    expect(diagnosedMisconception(item, 1)).toBe("plants eat sunlight");
  });

  it("returns null for the correct option (it diagnoses nothing)", () => {
    const item = buildItem(VALID_MCQ).item;
    expect(diagnosedMisconception(item, 0)).toBeNull();
  });

  it("returns null when payload.options is not an array (undefined)", () => {
    const item = withOptions(undefined);
    expect(diagnosedMisconception(item, 0)).toBeNull();
  });

  it("returns null when payload.options is a non-array value (string), without throwing", () => {
    const item = withOptions("not-an-array");
    expect(diagnosedMisconception(item, 0)).toBeNull();
  });

  it("returns null when the chosen index is out of bounds", () => {
    const item = withOptions([{ diagnosesMisconception: "x" }]);
    expect(diagnosedMisconception(item, 5)).toBeNull();
  });

  it("returns null for a negative index", () => {
    const item = withOptions([{ diagnosesMisconception: "x" }]);
    expect(diagnosedMisconception(item, -1)).toBeNull();
  });

  it("returns null when the option has no diagnosesMisconception property", () => {
    const item = withOptions([{ text: "just an option" }]);
    expect(diagnosedMisconception(item, 0)).toBeNull();
  });

  it("returns null when diagnosesMisconception is a non-string (number), not the value itself", () => {
    const item = withOptions([{ diagnosesMisconception: 42 }]);
    expect(diagnosedMisconception(item, 0)).toBeNull();
  });

  it("returns an empty string when diagnosesMisconception is an empty string (typeof, not truthiness)", () => {
    const item = withOptions([{ diagnosesMisconception: "" }]);
    expect(diagnosedMisconception(item, 0)).toBe("");
  });
});
