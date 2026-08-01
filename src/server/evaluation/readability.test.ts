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

/**
 * Mutation-hardening — each test pins the EXACT numeric output at a spot the prior suite left
 * un-pinned, so a Stryker mutation of that exact code element turns the assertion red. Every case
 * documents the original value and how the targeted mutant diverges from it.
 */
describe("readability — mutation-hardening: exact-value kills for surviving mutants", () => {
  it("uppercase polysyllabic word is still hard → guards `.toLowerCase()` (syllables regex line)", () => {
    // "EVALUATION" lowercases to 4 vowel-groups (e·a·ua·io) → hard. Drop `.toLowerCase()` and the
    // case-sensitive /[aeiou]+/g (no `i` flag) matches nothing → 0 syllables → not hard → ratio 0.
    const r = readability("EVALUATION.");
    expect(r.wordsPerSentence).toBe(1); // 1 word / 1 sentence
    expect(r.hardWordRatio).toBe(1); // 1 hard / 1 word
    expect(r.band).toBe("too_hard");
  });

  it("a run of adjacent vowels is ONE syllable → guards the `+` in /[aeiou]+/g (line 24)", () => {
    // "aeiou" is a single vowel-group (1 syllable, not hard); "evaluation" is 4 (hard) → 1 hard / 2.
    // Remove the `+` and each vowel counts alone: aeiou→5 and evaluation→6 → both hard → ratio 1.
    const r = readability("aeiou evaluation.");
    expect(r.wordsPerSentence).toBe(2); // 2 words / 1 sentence
    expect(r.hardWordRatio).toBe(0.5); // exactly 1 hard / 2 words
    expect(r.band).toBe("too_hard");
  });

  it("a vowel-less word yields 0 syllables via the `?? []` fallback (line 24)", () => {
    // "rhythm" has no a/e/i/o/u → match is null → `?? []` → length 0, not hard. Exercises the null
    // branch the prior suite never hit (if `??` degrades to `&&`, `null && []` then `.length` throws).
    const r = readability("rhythm cat.");
    expect(r.wordsPerSentence).toBe(2); // 2 words / 1 sentence
    expect(r.hardWordRatio).toBe(0); // neither word is hard
    expect(r.band).toBe("ok");
  });

  it("`!` terminates a sentence → guards the `!` in the /[.!?]+/ split (line 30)", () => {
    // Two `!`-terminated sentences → 2 sentences. Drop `!` from the class and the whole string is a
    // single sentence → wordsPerSentence jumps 2 → 4.
    const r = readability("Go now! Run fast!");
    expect(r.wordsPerSentence).toBe(2); // 4 words / 2 sentences
    expect(r.hardWordRatio).toBe(0);
    expect(r.band).toBe("ok");
  });

  it("`?` terminates a sentence → guards the `?` in the /[.!?]+/ split (line 30)", () => {
    // Same shape as the `!` case but for `?`; drop `?` from the class → 1 sentence → 4/1 = 4.
    const r = readability("Run now? Go fast?");
    expect(r.wordsPerSentence).toBe(2); // 4 words / 2 sentences
    expect(r.hardWordRatio).toBe(0);
    expect(r.band).toBe("ok");
  });

  it("an all-whitespace segment is dropped → guards `.trim()` before the length filter (line 31)", () => {
    // Segments are ["A", " ", " B", ""]; `.trim()` turns " " into "" so the length>0 filter drops it
    // → 2 sentences. Without `.trim()` the lone-space segment survives → 3 sentences (2/3 ≠ 1).
    const r = readability("A. . B.");
    expect(r.wordsPerSentence).toBe(1); // 2 words / 2 sentences
    expect(r.band).toBe("ok");
  });

  it("wordsPerSentence is words ÷ sentences with >1 sentence → guards the `/` (ratio line)", () => {
    // 6 words over 2 sentences = 3. `*`→12, `+`→8, `-`→4, `%`→0 — every arithmetic swap misses 3.
    // (The prior suite only had single-sentence inputs, where `/1` and `*1` are indistinguishable.)
    const r = readability("cat cat cat. dog dog dog.");
    expect(r.wordsPerSentence).toBe(3);
    expect(r.hardWordRatio).toBe(0);
    expect(r.band).toBe("ok");
  });

  it("exactly 3 syllables is NOT hard → guards `> HARD_WORD_MIN_SYLLABLES` and the band `&&` (line 37)", () => {
    // "banana" = 3 vowel-groups → not hard (needs strictly > 3); "evaluation" = 4 → hard → 1/2 = 0.5.
    // `>`→`>=` makes banana hard (ratio 1); `>`→`<` makes neither hard (ratio 0).
    // Band: 2<=22 true, 0.5<=0.2 false → too_hard; `&&`→`||` would flip it to "ok".
    const r = readability("banana evaluation.");
    expect(r.wordsPerSentence).toBe(2); // 2 words / 1 sentence
    expect(r.hardWordRatio).toBe(0.5); // exactly 1 hard / 2 words
    expect(r.band).toBe("too_hard");
  });
});
