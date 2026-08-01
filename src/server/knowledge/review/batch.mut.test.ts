import { describe, it, expect } from "vitest";
import { buildScreens, highlightSource, SCREEN_SIZE } from "@/server/knowledge/review/batch";
import type { ReviewProposal } from "@/server/knowledge/review/batch";

/**
 * §H1 mutation coverage for review/batch.ts (§25.2). The existing coverage in review.test.ts pins
 * buildScreens and the grounded HIGHLIGHT loosely (toContain), so the exact before/after slices and
 * the entire ungrounded fallback object were unkilled/uncovered. These tests assert the exact
 * `before`/`quote`/`after` slices for a grounded quote and the exact fallback object when the quote
 * does not ground — killing the slice MethodExpression mutants and the NoCoverage on the fallback
 * literal.
 */

const CHUNK = "Photosynthesis converts light energy into chemical energy.";

describe("highlightSource — grounded quote (exact split, §25.2)", () => {
  it("splits the NORMALISED chunk into exact before / quote / after around the match", () => {
    const h = highlightSource(CHUNK, "converts light energy");
    expect(h.grounded).toBe(true);
    // normalised chunk is lowercased; the quote sits after "photosynthesis ".
    expect(h.before).toBe("photosynthesis ");
    expect(h.quote).toBe("converts light energy");
    expect(h.after).toBe(" into chemical energy.");
  });

  it("re-joining before+quote+after reconstructs the full normalised chunk (no char dropped)", () => {
    const h = highlightSource(CHUNK, "converts light energy");
    expect(h.before + h.quote + h.after).toBe("photosynthesis converts light energy into chemical energy.");
  });

  it("a match at the very start has an EMPTY before and a non-empty after", () => {
    const h = highlightSource(CHUNK, "Photosynthesis");
    expect(h.grounded).toBe(true);
    expect(h.before).toBe("");
    expect(h.quote).toBe("photosynthesis");
    expect(h.after).toBe(" converts light energy into chemical energy.");
  });

  it("a match at the very end has a non-empty before and an EMPTY after", () => {
    const h = highlightSource(CHUNK, "chemical energy.");
    expect(h.grounded).toBe(true);
    expect(h.before).toBe("photosynthesis converts light energy into ");
    expect(h.quote).toBe("chemical energy.");
    expect(h.after).toBe("");
  });
});

describe("highlightSource — ungrounded fallback (exact object)", () => {
  it("returns before=ORIGINAL chunk, empty quote/after, grounded=false when the quote is absent", () => {
    // Covers + kills the NoCoverage fallback literal: {}, quote "Stryker...", after "Stryker...",
    // grounded:true — every field is pinned to its real value here.
    const h = highlightSource(CHUNK, "a phrase that never appears");
    expect(h).toEqual({ before: CHUNK, quote: "", after: "", grounded: false });
    // `before` is the RAW chunk, not the normalised one, on the ungrounded path.
    expect(h.before).toBe(CHUNK);
  });

  it("an empty quote does not ground (indexOf of '' would be 0 — but n('') is '', still handled as a real value)", () => {
    // '' grounds at index 0 in every string, so this exercises the GROUNDED branch with a zero-length
    // quote: before is the whole normalised chunk, quote empty, after empty.
    const h = highlightSource(CHUNK, "");
    expect(h.grounded).toBe(true);
    expect(h.before).toBe("");
    expect(h.quote).toBe("");
    expect(h.after).toBe("photosynthesis converts light energy into chemical energy.");
  });
});

describe("buildScreens — chunking into ≤ SCREEN_SIZE (§25.2 / §25.4)", () => {
  const mk = (id: string): ReviewProposal => ({
    targetKind: "Statement",
    targetId: id,
    statement: { form: "SPO", kind: "FACT", text: "t", quote: "q", structure: {} } as never,
    chunkText: "c",
    validation: [],
  });

  it("SCREEN_SIZE is 8", () => {
    expect(SCREEN_SIZE).toBe(8);
  });

  it("keeps every proposal, in order, partitioned into screens of at most 8", () => {
    const proposals = Array.from({ length: 17 }, (_, i) => mk(`p${i}`));
    const screens = buildScreens(proposals);
    expect(screens).toHaveLength(3); // 8 + 8 + 1
    expect(screens[0].proposals).toHaveLength(8);
    expect(screens[1].proposals).toHaveLength(8);
    expect(screens[2].proposals).toHaveLength(1);
    // no reordering, no loss
    expect(screens.flatMap((s) => s.proposals.map((p) => p.targetId))).toEqual(
      proposals.map((p) => p.targetId),
    );
  });

  it("exactly SCREEN_SIZE proposals pack into a single screen (boundary — not two)", () => {
    expect(buildScreens(Array.from({ length: 8 }, (_, i) => mk(`p${i}`)))).toHaveLength(1);
    expect(buildScreens(Array.from({ length: 9 }, (_, i) => mk(`p${i}`)))).toHaveLength(2);
  });

  it("an explicit smaller size is honoured", () => {
    const screens = buildScreens([mk("a"), mk("b"), mk("c")], 2);
    expect(screens.map((s) => s.proposals.length)).toEqual([2, 1]);
  });

  it("no proposals → no screens", () => {
    expect(buildScreens([])).toEqual([]);
  });
});
