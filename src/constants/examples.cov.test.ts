import { describe, it, expect } from "vitest";
import { EXAMPLES } from "@/constants/examples";

/**
 * EXAMPLES — the rotating example prompts shown on the entry screen.
 *
 * This is a frozen data constant (no functions/branches of its own), but it is a
 * load-bearing contract: `useAgabi` rotates through it with `(exIndex + 1) %
 * EXAMPLES.length` and indexes it directly with `EXAMPLES[exIndex]`. So the tests
 * pin the EXACT contents, order, length, and shape — any string edit, reorder,
 * addition, removal, or emptied literal (the mutations Stryker will try) flips a
 * concrete assertion below. No shallow "it is defined" line-touching here.
 */

// The verbatim source-of-truth copy, duplicated here so a mutation to the module
// (not the test) is what fails — the test never re-derives from the module.
const EXPECTED = [
  "Teach me quadratic equations",
  "Why is the sky blue?",
  "Help me master Newton's laws",
  "Explain DNA replication",
  "Prepare me for tomorrow's physics exam",
  "Teach me integration",
  "I don't understand probability",
] as const;

describe("EXAMPLES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(EXAMPLES)).toBe(true);
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it("has exactly 7 prompts", () => {
    expect(EXAMPLES.length).toBe(7);
  });

  it("deep-equals the exact expected list, in order", () => {
    expect(EXAMPLES).toEqual(EXPECTED);
    // Element-identity + ordering guard: toEqual alone would pass a reordered
    // copy of the same members, so pin each slot's exact string too.
    expect([...EXAMPLES]).toStrictEqual([...EXPECTED]);
  });

  it("pins each slot's exact string by index", () => {
    expect(EXAMPLES[0]).toBe("Teach me quadratic equations");
    expect(EXAMPLES[1]).toBe("Why is the sky blue?");
    expect(EXAMPLES[2]).toBe("Help me master Newton's laws");
    expect(EXAMPLES[3]).toBe("Explain DNA replication");
    expect(EXAMPLES[4]).toBe("Prepare me for tomorrow's physics exam");
    expect(EXAMPLES[5]).toBe("Teach me integration");
    expect(EXAMPLES[6]).toBe("I don't understand probability");
  });

  it("reads undefined just past the last slot (no phantom 8th prompt)", () => {
    expect((EXAMPLES as readonly string[])[7]).toBeUndefined();
  });

  it("holds only non-empty, trimmed strings", () => {
    for (const prompt of EXAMPLES) {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toBe(prompt.trim());
    }
  });

  it("contains no duplicate prompts", () => {
    expect(new Set(EXAMPLES).size).toBe(EXAMPLES.length);
  });

  it("supports the consumer's modulo rotation across every slot and back to 0", () => {
    // Mirrors useAgabi's `(exIndex + 1) % EXAMPLES.length` cycle. Walking one full
    // lap must visit each of the 7 indices exactly once and return to the start.
    const visited: number[] = [];
    let idx = 0;
    for (let step = 0; step < EXAMPLES.length; step++) {
      visited.push(idx);
      expect(EXAMPLES[idx]).toBe(EXPECTED[idx]);
      idx = (idx + 1) % EXAMPLES.length;
    }
    expect(visited).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(idx).toBe(0);
  });
});
