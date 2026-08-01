import { describe, it, expect } from "vitest";
import { understandIntent } from "@/server/conversation/understand";

/**
 * The Intent Object is a PURE structuring of a validated intent label — no model, no I/O.
 * It exists so the Capability Router has one typed thing to route on (L3: we route on the
 * DECISION-relevant fields, not the model's raw text). Every assertion names the exact field.
 */
describe("understandIntent — validated label → structured Intent Object", () => {
  it("a topic message carries the topic and REQUIRES corpus (a new lesson must be grounded)", () => {
    const io = understandIntent("topic", "  photosynthesis  ");
    expect(io.intent).toBe("topic");
    expect(io.topic).toBe("photosynthesis"); // trimmed
    expect(io.requiresCorpus).toBe(true);
    expect(io.confidence).toBe("high");
  });

  it("switch_topic carries the target as the topic, and does NOT require corpus (resuming an existing lesson)", () => {
    const io = understandIntent("switch_topic", "go back to the water cycle", "the water cycle");
    expect(io.intent).toBe("switch_topic");
    expect(io.topic).toBe("the water cycle");
    expect(io.requiresCorpus).toBe(false);
  });

  it("a non-topic intent has a null topic and never requires corpus", () => {
    for (const intent of ["greeting", "smalltalk", "continue", "followup", "clarification", "pause"] as const) {
      const io = understandIntent(intent, "whatever");
      expect(io.topic).toBeNull();
      expect(io.requiresCorpus).toBe(false);
    }
  });

  it("unclear is LOW confidence (drives clarify, never a lesson)", () => {
    const io = understandIntent("unclear", "hmm");
    expect(io.confidence).toBe("low");
    expect(io.requiresCorpus).toBe(false);
    expect(io.topic).toBeNull();
  });
});
