import { describe, it, expect } from "vitest";

import { cn } from "@/utils/cn";

/**
 * cn(...inputs) = twMerge(clsx(inputs)) — a two-layer composition:
 *   - clsx layer:  flattens strings/numbers/arrays/objects into a class string,
 *                  dropping falsy values, honoring object-conditional truthiness.
 *   - twMerge layer: collapses CONFLICTING Tailwind utilities, last one wins.
 *
 * The tests below are written to kill both "drop a layer" mutants:
 *   - Object-conditional cases only produce the right output if the clsx layer runs
 *     (twMerge alone ignores plain objects → would yield ""). They pin the clsx layer.
 *   - Tailwind-conflict cases only collapse if the twMerge layer runs (clsx alone would
 *     keep both conflicting classes). They pin the twMerge layer.
 * Every assertion pins an EXACT string, so a swapped/removed call is caught, not just
 * "returned something".
 */
describe("cn — clsx layer (conditional class construction)", () => {
  it("joins multiple string args with single spaces, preserving order", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns a string (never null/undefined) for an all-falsy call", () => {
    const result = cn(null, undefined, false);
    expect(typeof result).toBe("string");
    expect(result).toBe("");
  });

  it("filters out every falsy value (null, undefined, false, empty string, 0)", () => {
    expect(cn("keep", null, undefined, false, "", 0)).toBe("keep");
  });

  it("renders non-zero numbers as strings and drops 0 (clsx numeric rule)", () => {
    // 0 is falsy → dropped; 1 and 2 are truthy → stringified. "1"/"2"/"a" are not
    // Tailwind utilities, so twMerge leaves them untouched — this isolates clsx's
    // numeric handling.
    expect(cn("a", 0, 1, 2)).toBe("a 1 2");
  });

  it("includes object keys whose value is truthy and drops falsy-valued keys", () => {
    // Pure clsx behavior: twMerge on its own ignores plain objects → this dies if the
    // clsx layer is removed.
    expect(cn({ shown: true, hidden: false })).toBe("shown");
  });

  it("mixes strings with object-conditional keys in encounter order", () => {
    expect(cn("base", { active: true, disabled: false }, "end")).toBe("base active end");
  });

  it("flattens nested arrays of class values", () => {
    expect(cn(["a", ["b", ["c"]]])).toBe("a b c");
  });

  it("flattens arrays that contain falsy holes and objects", () => {
    expect(cn(["a", null, { b: true, c: false }])).toBe("a b");
  });
});

describe("cn — twMerge layer (Tailwind conflict resolution)", () => {
  it("keeps the last of two conflicting utilities from the same group", () => {
    // clsx alone would yield "px-2 px-4"; only twMerge collapses to the winner.
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("resolves a conflict expressed inside a single string arg", () => {
    expect(cn("px-2 py-1 px-4")).toBe("py-1 px-4");
  });

  it("lets a later arg override an earlier conflicting color utility", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("resolves a conflict where the winner comes from an object-conditional key", () => {
    // Requires BOTH layers: clsx to turn the object into "text-blue-500", twMerge to
    // drop the earlier "text-red-500".
    expect(cn("text-red-500", { "text-blue-500": true })).toBe("text-blue-500");
  });

  it("keeps non-conflicting utilities from different groups, in order", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("does NOT treat a variant-prefixed utility as conflicting with the base one", () => {
    // Different states (base vs hover) are not a conflict — both survive.
    expect(cn("bg-red-500", "hover:bg-blue-500")).toBe("bg-red-500 hover:bg-blue-500");
  });

  it("collapses an exact duplicate utility to a single occurrence", () => {
    expect(cn("flex", "flex")).toBe("flex");
  });

  it("normalizes surrounding and interior whitespace to single spaces", () => {
    expect(cn("  a   b  ")).toBe("a b");
  });
});
