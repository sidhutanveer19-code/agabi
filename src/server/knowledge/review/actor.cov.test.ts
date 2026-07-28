import { describe, it, expect } from "vitest";
import { isHumanActor, assertHumanActor, MACHINE_ACTOR_PREFIX } from "@/server/knowledge/review/actor";

/**
 * §H1 mutation coverage for the human-actor guard (§26.2, §27, ADR-10). `actor.ts` was reached
 * only indirectly (through merge/lifecycle) and those callers only asserted `/human actorId/`, so
 * the guard's message-building (`shown = actorId.trim() || "(blank)"`) and the exact prefix/prefix-
 * casing of `isHumanActor` were never pinned. These tests drive both functions directly and assert
 * the EXACT strings, killing the ConditionalExpression/LogicalOperator/StringLiteral/MethodExpression
 * mutants on the `shown` expression and the reserved-prefix comparison.
 */

describe("MACHINE_ACTOR_PREFIX", () => {
  it("is the reserved 'system:' namespace this codebase writes", () => {
    expect(MACHINE_ACTOR_PREFIX).toBe("system:");
  });
});

describe("isHumanActor — human vs machine namespace", () => {
  it("a plain reviewer id is human", () => {
    expect(isHumanActor("rev-1")).toBe(true);
    expect(isHumanActor("Roberta")).toBe(true);
  });

  it("trims surrounding whitespace before judging (padded human id is still human)", () => {
    expect(isHumanActor("  rev-1  ")).toBe(true);
  });

  it("an empty id is not human", () => {
    expect(isHumanActor("")).toBe(false);
  });

  it("a whitespace-only id is not human (trim → length 0)", () => {
    expect(isHumanActor("   \t\n ")).toBe(false);
  });

  it("the machine prefix marks a non-human actor", () => {
    expect(isHumanActor("system:ingest")).toBe(false);
  });

  it("exactly the bare prefix 'system:' is non-human (startsWith is inclusive of equality)", () => {
    expect(isHumanActor("system:")).toBe(false);
  });

  it("the prefix check is case-insensitive (proves .toLowerCase() runs)", () => {
    expect(isHumanActor("SYSTEM:ingest")).toBe(false);
    expect(isHumanActor("System:Bot")).toBe(false);
  });

  it("a name that merely STARTS with 'system' but not 'system:' is human (colon is load-bearing)", () => {
    // "systems-thinking" starts with "system" but the 7th char is 's', not ':'.
    expect(isHumanActor("systems-thinking")).toBe(true);
  });

  it("the prefix is judged after trimming, so leading spaces do not smuggle a machine id past it", () => {
    expect(isHumanActor("   system:ingest")).toBe(false);
  });
});

describe("assertHumanActor — passes a human through", () => {
  it("returns undefined (does not throw) for a real reviewer id", () => {
    expect(assertHumanActor("rev-1", "merge")).toBeUndefined();
  });

  it("does not throw for a padded human id", () => {
    expect(() => assertHumanActor("  editor-9  ", "promotion")).not.toThrow();
  });
});

describe("assertHumanActor — the refusal message (§26.2)", () => {
  it("a blank actor is shown as '(blank)', not the empty string or a boolean", () => {
    // Kills: shown=true, shown=false, shown="" (StringLiteral), shown=actorId.trim() && "(blank)".
    expect(() => assertHumanActor("", "act")).toThrow(
      "act requires a human actorId (§26.2) — got (blank)",
    );
  });

  it("a whitespace-only actor is ALSO shown as '(blank)' (proves .trim() runs before the ||)", () => {
    // Kills: shown=actorId || "(blank)" — that mutant would echo the raw spaces "   " instead.
    expect(() => assertHumanActor("   ", "act")).toThrow(
      "act requires a human actorId (§26.2) — got (blank)",
    );
  });

  it("a NON-blank machine actor is echoed verbatim (its trimmed id, never '(blank)')", () => {
    // Kills: shown=true, shown=false, shown=actorId.trim() && "(blank)" (→ "(blank)"), shown="".
    expect(() => assertHumanActor("system:ingest", "act")).toThrow(
      "act requires a human actorId (§26.2) — got system:ingest",
    );
  });

  it("a padded machine actor is echoed TRIMMED (proves the shown value is actorId.trim(), not actorId)", () => {
    expect(() => assertHumanActor("  system:cron  ", "act")).toThrow(
      "act requires a human actorId (§26.2) — got system:cron",
    );
  });

  it("interpolates the caller's `action` verbatim as the prefix", () => {
    expect(() => assertHumanActor("system:bot", "promotion to APPROVED")).toThrow(
      "promotion to APPROVED requires a human actorId (§26.2) — got system:bot",
    );
  });
});
