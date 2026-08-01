import { describe, it, expect } from "vitest";
import { priority, prioritise, DEFAULT_WEIGHTS, type QueueItem, type QueueWeights } from "@/server/knowledge/review/queue";

/**
 * §H1 mutation coverage for review/queue.ts (§25.3). review.test.ts pinned prioritise loosely with
 * items whose priority order happened to coincide with id order, so the tie-break ternary and the
 * `if (d !== 0)` short-circuit survived. These tests:
 *   1. pin the EXACT numeric value of `priority()` for every term (kills the +/-/* mutants and the
 *      program-sign flip on line 31), and
 *   2. drive prioritise with priority order DELIBERATELY reversed from id order, so the id tie-break
 *      is exercised on equal-priority items and the priority short-circuit on unequal ones.
 */

const item = (over: Partial<QueueItem>): QueueItem => ({
  targetKind: "Statement",
  targetId: "x",
  dependentCount: 0,
  knowledgeMissCount: 0,
  programWeight: 0,
  ageInQueue: 0,
  ...over,
});

describe("priority — exact term-by-term value (§25.3 formula)", () => {
  it("all zeros → 0", () => {
    expect(priority(item({}))).toBe(0);
  });

  it("dependentCount is weighted ×3 (DEFAULT_WEIGHTS.dependent)", () => {
    expect(priority(item({ dependentCount: 1 }))).toBe(3);
    expect(priority(item({ dependentCount: 2 }))).toBe(6);
  });

  it("knowledgeMissCount is weighted ×2 (DEFAULT_WEIGHTS.miss)", () => {
    expect(priority(item({ knowledgeMissCount: 1 }))).toBe(2);
    expect(priority(item({ knowledgeMissCount: 5 }))).toBe(10);
  });

  it("programWeight is ADDED, weighted ×1 (kills the `- w.program` sign flip)", () => {
    expect(priority(item({ programWeight: 1 }))).toBe(1);
    expect(priority(item({ programWeight: 4 }))).toBe(4);
  });

  it("ageInQueue is SUBTRACTED, weighted ×0.1 (starvation guard)", () => {
    expect(priority(item({ ageInQueue: 1 }))).toBeCloseTo(-0.1, 10);
    expect(priority(item({ ageInQueue: 10 }))).toBeCloseTo(-1, 10);
  });

  it("combines every term with the right signs: 3·1 + 2·1 + 1·1 − 0.1·1 = 5.9", () => {
    expect(priority(item({ dependentCount: 1, knowledgeMissCount: 1, programWeight: 1, ageInQueue: 1 }))).toBeCloseTo(5.9, 10);
  });

  it("a bigger program term is dwarfed by dependents+miss but still lifts the total (add, not subtract)", () => {
    // dep 2 (6) + miss 3 (6) + program 4 (4) - age 0 = 16
    expect(priority(item({ dependentCount: 2, knowledgeMissCount: 3, programWeight: 4 }))).toBe(16);
  });

  it("honours custom weights", () => {
    const w: QueueWeights = { dependent: 5, miss: 7, program: 11, age: 2 };
    expect(priority(item({ dependentCount: 1 }), w)).toBe(5);
    expect(priority(item({ knowledgeMissCount: 1 }), w)).toBe(7);
    expect(priority(item({ programWeight: 1 }), w)).toBe(11);
    expect(priority(item({ ageInQueue: 1 }), w)).toBe(-2);
    expect(priority(item({ dependentCount: 1, knowledgeMissCount: 1, programWeight: 1, ageInQueue: 1 }), w)).toBe(5 + 7 + 11 - 2);
  });

  it("DEFAULT_WEIGHTS are exactly {dependent:3, miss:2, program:1, age:0.1}", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ dependent: 3, miss: 2, program: 1, age: 0.1 });
  });
});

describe("prioritise — priority dominates, id breaks ties (deterministic)", () => {
  it("orders strictly by priority (highest first), NOT by id, when priorities differ", () => {
    // The high-priority item has the LARGER id, so an id-only sort would put it LAST.
    const high = item({ targetId: "zzz", knowledgeMissCount: 100 }); // priority 200
    const low = item({ targetId: "aaa", knowledgeMissCount: 0 }); //    priority 0
    // insertion order is [low, high]; correct order is [high, low].
    expect(prioritise([low, high]).map((i) => i.targetId)).toEqual(["zzz", "aaa"]);
    expect(prioritise([high, low]).map((i) => i.targetId)).toEqual(["zzz", "aaa"]);
  });

  it("breaks ties by ascending id when priorities are EQUAL (independent of insertion order)", () => {
    const a = item({ targetId: "a" });
    const b = item({ targetId: "b" });
    const c = item({ targetId: "c" });
    // all priority 0; every insertion permutation must yield ascending id order.
    expect(prioritise([b, a, c]).map((i) => i.targetId)).toEqual(["a", "b", "c"]);
    expect(prioritise([c, b, a]).map((i) => i.targetId)).toEqual(["a", "b", "c"]);
    expect(prioritise([a, c, b]).map((i) => i.targetId)).toEqual(["a", "b", "c"]);
  });

  it("mixes both rules: equal-priority pair tie-breaks by id, all above a lower-priority item", () => {
    const p1 = item({ targetId: "y", dependentCount: 1 }); // priority 3
    const p2 = item({ targetId: "x", dependentCount: 1 }); // priority 3 (ties with y → x first by id)
    const p0 = item({ targetId: "a", dependentCount: 0 }); // priority 0 (last despite smallest id)
    expect(prioritise([p0, p1, p2]).map((i) => i.targetId)).toEqual(["x", "y", "a"]);
  });

  it("is a pure copy — the input array is not mutated", () => {
    const input = [item({ targetId: "b" }), item({ targetId: "a" })];
    const snapshot = input.map((i) => i.targetId);
    prioritise(input);
    expect(input.map((i) => i.targetId)).toEqual(snapshot);
  });

  it("age lowers priority: an older item with no demand sinks below a fresh one with demand", () => {
    const stale = item({ targetId: "a", ageInQueue: 100 }); // priority -10
    const fresh = item({ targetId: "z", knowledgeMissCount: 1 }); // priority 2
    expect(prioritise([stale, fresh]).map((i) => i.targetId)).toEqual(["z", "a"]);
  });
});
