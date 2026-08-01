import { describe, it, expect } from "vitest";
import { batchSystemPrompt, textStreamSystem, jsonSlotSystem } from "@/server/conversation/prompt";

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
