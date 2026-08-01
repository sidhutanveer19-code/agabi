import { describe, it, expect } from "vitest";
import { batchSystemPrompt, textStreamSystem, jsonSlotSystem, noRepeatDirective, noRepeatForLesson } from "@/server/conversation/prompt";

// The WIRING guard (§H1.7 — test the wiring, not just the function). The self-match bug: the lesson
// being taught appears in previousLessons before it becomes active, so it matched ITSELF and fired
// no-repeat on a topic's FIRST teaching. noRepeatForLesson must exclude the current lesson id.
describe("noRepeatForLesson — never self-matches on a topic's first teaching", () => {
  it("does NOT fire when the only prior lesson IS the one being taught (same id)", () => {
    const prior = [{ id: "L1", topic: "real numbers", coveredTypes: ["mindmap"] }];
    expect(noRepeatForLesson("L1", "real numbers", prior)).toBe(""); // self excluded → first teaching, no fire
  });
  it("DOES fire when a DIFFERENT prior lesson taught the same topic (a real re-ask)", () => {
    const prior = [
      { id: "L0", topic: "real numbers", coveredTypes: ["mindmap"] }, // earlier lesson
      { id: "L1", topic: "real numbers", coveredTypes: ["formula"] }, // the one being taught now
    ];
    expect(noRepeatForLesson("L1", "real numbers", prior)).not.toBe(""); // real repeat → fires
  });
});

// Phase 4 — no-repeat: re-asking a topic must teach it DIFFERENTLY, and vary against the EXACT blocks
// it used last time (not just "vary").
describe("noRepeatDirective — never replay the same explanation", () => {
  it("is empty when the topic is NEW (not taught before)", () => {
    expect(noRepeatDirective("real numbers", [])).toBe("");
    expect(noRepeatDirective("real numbers", [{ topic: "polynomials", coveredTypes: ["mindmap"] }])).toBe("");
  });
  it("fires AND names the blocks used last time, when re-asked (case/space-insensitive)", () => {
    const d = noRepeatDirective("Real Numbers", [{ topic: "  real numbers  ", coveredTypes: ["mindmap", "formula"] }]).toLowerCase();
    expect(d).toMatch(/already taught|do not repeat|different/);
    expect(d).toMatch(/deeper|new|harder|fresh|angle/); // tells it HOW to vary
    expect(d).toMatch(/mindmap|formula/);               // varies against what it actually used
  });
  it("matches singular/plural (circle ↔ circles)", () => {
    expect(noRepeatDirective("circles", [{ topic: "circle", coveredTypes: [] }])).not.toBe("");
    expect(noRepeatDirective("real number", [{ topic: "real numbers", coveredTypes: [] }])).not.toBe("");
  });
  it("does NOT fire on a DIFFERENT, more specific topic (no substring over-match)", () => {
    // the old bug: 'area' wrongly matched 'area of a circle'. These are different topics.
    expect(noRepeatDirective("area", [{ topic: "area of a circle", coveredTypes: ["geometry"] }])).toBe("");
    expect(noRepeatDirective("triangle", [{ topic: "similar triangles theorem", coveredTypes: [] }])).toBe("");
  });
  it("empty topic never fires (no false trigger)", () => {
    expect(noRepeatDirective("   ", [{ topic: "anything", coveredTypes: ["table"] }])).toBe("");
  });
});

// The LIVE teaching prompts (batch = tool providers, textStream/jsonSlot = Ollama) must carry the
// mentor contract (docs/TEACHING.md), so every block teaches understanding — not a reworded definition.
describe("live teaching prompts embody the mentor contract", () => {
  it("the batch prompt (primary path) teaches like a mentor", () => {
    const p = batchSystemPrompt().toLowerCase();
    expect(p).toMatch(/mechanism/);                              // mechanism, not definition
    expect(p).toMatch(/never (restate|reword)|do not restate/); // never restate the definition
    expect(p).toMatch(/analogy/);                               // intuition via analogy
    expect(p).toMatch(/intuition/);
    expect(p).toMatch(/when to (use|avoid)/);                   // teach decisions
    expect(p).toMatch(/real.?world/);                           // connect to the real world
  });

  it("the Ollama fallback prompts carry the same style (no generic path)", () => {
    for (const p of [textStreamSystem().toLowerCase(), jsonSlotSystem().toLowerCase()]) {
      expect(p).toMatch(/mechanism|analogy|do not restate|never restate/);
    }
  });
});
