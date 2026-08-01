import { describe, it, expect } from "vitest";
import {
  readability,
  MAX_WORDS_PER_SENTENCE,
  MAX_HARD_WORD_RATIO,
  type Readability,
} from "@/server/evaluation/readability";

/**
 * Readability KPI — is the prose in the Class-10 band? (L1: readability is a measured number.) Pure,
 * total math over text. Every assertion names the EXACT number (§H1.2); the 22↔23 and 0.2 tests sit
 * ON the threshold so a flipped `<=`/`<` goes red (mutation-proof, §H1.5).
 */

describe("readability — sentence length + hard-word density → Class-10 band", () => {
  it("a short plain sentence → band ok with exact wordsPerSentence", () => {
    const r: Readability = readability("The cat sat on the mat.");
    expect(r.wordsPerSentence).toBe(6); // 6 words / 1 sentence
    expect(r.hardWordRatio).toBe(0); // all monosyllabic
    expect(r.band).toBe("ok");
  });

  it("a long run-on (> 22 words, one sentence) → too_hard on sentence length alone", () => {
    const runOn = Array.from({ length: 30 }, () => "cat").join(" ") + ".";
    const r = readability(runOn);
    expect(r.wordsPerSentence).toBe(30); // 30 words / 1 sentence
    expect(r.hardWordRatio).toBe(0); // hard-word lever is clean → band fails on length
    expect(r.band).toBe("too_hard");
  });

  it("empty string → {0, 0, ok} (total, never NaN)", () => {
    const r = readability("");
    expect(r).toEqual({ wordsPerSentence: 0, hardWordRatio: 0, band: "ok" });
  });

  it("a sentence stuffed with polysyllabic words → too_hard on hard-word density", () => {
    // "evaluation"(4) "communication"(5) "examination"(5) — each has > 3 vowel-groups → all hard.
    const r = readability("Evaluation communication examination.");
    expect(r.wordsPerSentence).toBe(3); // 3 words / 1 sentence — well under 22
    expect(r.hardWordRatio).toBe(1); // 3 hard / 3 words → band fails on density
    expect(r.band).toBe("too_hard");
  });

  it("EXACTLY 22 words → ok; 23 → too_hard (pins MAX_WORDS_PER_SENTENCE, guards <=)", () => {
    const words22 = Array.from({ length: 22 }, () => "cat").join(" ") + ".";
    const words23 = Array.from({ length: 23 }, () => "cat").join(" ") + ".";
    expect(readability(words22).wordsPerSentence).toBe(22);
    expect(readability(words22).band).toBe("ok"); // 22 <= 22
    expect(readability(words23).wordsPerSentence).toBe(23);
    expect(readability(words23).band).toBe("too_hard"); // 23 > 22
    expect(MAX_WORDS_PER_SENTENCE).toBe(22);
  });

  it("hardWordRatio EXACTLY at 0.2 → ok; just over → too_hard (pins MAX_HARD_WORD_RATIO, guards <=)", () => {
    // 1 hard / 5 words = 0.2 (exactly representable) → ok.
    const atFloor = readability("evaluation cat sat on mat.");
    expect(atFloor.hardWordRatio).toBe(0.2);
    expect(atFloor.band).toBe("ok"); // 0.2 <= 0.2
    // 2 hard / 5 words = 0.4 → over the floor → too_hard.
    const overFloor = readability("evaluation communication sat on mat.");
    expect(overFloor.hardWordRatio).toBe(0.4);
    expect(overFloor.band).toBe("too_hard"); // 0.4 > 0.2
    expect(MAX_HARD_WORD_RATIO).toBe(0.2);
  });
});
