/**
 * Readability KPI — is the prose in the Class-10 band? (L1: readability is a measured number, not a
 * feeling; L5: this is the ONE place the readability KPI is computed.) No I/O, no model — deterministic
 * math over text. Every function is total: empty text → 0, never NaN / divide-by-zero.
 */

export interface Readability {
  wordsPerSentence: number; // words / sentences — 0 sentences OR 0 words → 0
  hardWordRatio: number; // hard words / words — 0 words → 0
  band: "ok" | "too_hard"; // "ok" only while BOTH levers are within the Class-10 ceilings
}

// Class-10 band ceilings. `band` is "ok" iff wordsPerSentence <= MAX_WORDS_PER_SENTENCE AND
// hardWordRatio <= MAX_HARD_WORD_RATIO (inclusive, both must hold), else "too_hard".
export const MAX_WORDS_PER_SENTENCE = 22;
export const MAX_HARD_WORD_RATIO = 0.2;

// A "hard" word is polysyllabic: strictly MORE than 3 syllables. Syllables are approximated by counting
// vowel-groups — maximal runs of a/e/i/o/u — in the lowercased word (y is deliberately not a vowel here).
const HARD_WORD_MIN_SYLLABLES = 3;

/** Syllable estimate = number of vowel-groups in the lowercased word (0 for a vowel-less token). */
function syllables(word: string): number {
  return (word.toLowerCase().match(/[aeiou]+/g) ?? []).length;
}

/** Sentence length + hard-word density of `text`, and whether it sits in the Class-10 band. */
export function readability(text: string): Readability {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const words = text.match(/[a-z0-9]+/gi) ?? [];

  const wordsPerSentence =
    sentences.length === 0 || words.length === 0 ? 0 : words.length / sentences.length;
  const hardWords = words.filter((w) => syllables(w) > HARD_WORD_MIN_SYLLABLES).length;
  const hardWordRatio = words.length === 0 ? 0 : hardWords / words.length;

  const band: Readability["band"] =
    wordsPerSentence <= MAX_WORDS_PER_SENTENCE && hardWordRatio <= MAX_HARD_WORD_RATIO
      ? "ok"
      : "too_hard";

  return { wordsPerSentence, hardWordRatio, band };
}
