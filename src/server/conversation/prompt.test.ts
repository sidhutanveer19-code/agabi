import { describe, it, expect } from "vitest";
import { batchSystemPrompt, textStreamSystem, jsonSlotSystem, noRepeatDirective } from "@/server/conversation/prompt";

// Phase 4 — no-repeat: re-asking a topic must teach it DIFFERENTLY, never paste the same lesson.
describe("noRepeatDirective — never replay the same explanation", () => {
  it("is empty when the topic is NEW (not taught before)", () => {
    expect(noRepeatDirective("real numbers", [])).toBe("");
    expect(noRepeatDirective("real numbers", ["polynomials", "triangles"])).toBe("");
  });
  it("fires when the topic was already taught (case/space-insensitive)", () => {
    const d = noRepeatDirective("Real Numbers", ["  real numbers  "]).toLowerCase();
    expect(d).toMatch(/already taught|do not repeat|different/);
    expect(d).toMatch(/deeper|new|harder|fresh|angle/); // tells it HOW to vary
  });
  it("matches singular/plural & contained topics (circle ↔ circles)", () => {
    expect(noRepeatDirective("circles", ["circle"])).not.toBe("");
    expect(noRepeatDirective("prime factorisation", ["prime factorisation of numbers"])).not.toBe("");
  });
  it("empty topic never fires (no false trigger)", () => {
    expect(noRepeatDirective("   ", ["anything"])).toBe("");
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
