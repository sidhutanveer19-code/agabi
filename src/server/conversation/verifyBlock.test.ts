import { describe, it, expect } from "vitest";
import { assessBlock, isDeliverable } from "@/server/conversation/verifyBlock";

/**
 * The composition the manager's verify hook calls: a rendered block's prose → claims → graded
 * against the lesson's source passages → groundedness + release verdict. This is the tested seam
 * so the manager glue is NOT a false green. The invariant it enforces: a contradicted or
 * insufficiently-grounded block is NOT deliverable (never stands as a READY block).
 */
const PASSAGES = [
  "Photosynthesis is the process by which green plants use sunlight to make food from carbon dioxide and water, releasing oxygen.",
];

describe("assessBlock — grounded prose passes, unfounded/contradicted prose is held back", () => {
  it("prose grounded in the passage → RELEASE and deliverable", () => {
    const a = assessBlock("Green plants use sunlight to make food from carbon dioxide and water.", PASSAGES);
    expect(a.verdict).toBe("RELEASE");
    expect(a.contradicted).toBe(0);
    expect(isDeliverable(a)).toBe(true);
  });

  it("a claim that CONTRADICTS the passage → REJECT, not deliverable", () => {
    // Strong lexical overlap with the passage ("green plants use sunlight to make food") PLUS a
    // negation = the claim denies the very thing the source asserts → a confident contradiction.
    const a = assessBlock("Green plants do not use sunlight to make food.", PASSAGES);
    expect(a.contradicted).toBeGreaterThanOrEqual(1);
    expect(a.verdict).toBe("REJECT");
    expect(isDeliverable(a)).toBe(false);
  });

  it("invented, ungrounded facts → below threshold → REGENERATE, not deliverable", () => {
    const a = assessBlock("The mitochondria negotiates trade tariffs with the nucleus every fortnight.", PASSAGES);
    expect(a.verdict).toBe("REGENERATE");
    expect(isDeliverable(a)).toBe(false);
  });

  it("pure scaffolding (an analogy) is deliverable but WARNs — never a perfect RELEASE", () => {
    // groundedness is still 1: the block asserted nothing unfounded, because it asserted no fact at
    // all. That is exactly why it must not RELEASE — a block with no verifiable sentence in it had
    // been scoring flawless. An analogy slot is legitimate, so it still reaches the student.
    const a = assessBlock("Think of a leaf like a tiny solar-powered kitchen.", PASSAGES);
    expect(a.groundedness).toBe(1);
    expect(a.verdict).toBe("WARN");
    expect(isDeliverable(a)).toBe(true);
  });

  it("no passages to ground against → a factual claim is not deliverable", () => {
    const a = assessBlock("The sky is a specific shade of green on Tuesdays.", []);
    expect(isDeliverable(a)).toBe(false);
  });
});
