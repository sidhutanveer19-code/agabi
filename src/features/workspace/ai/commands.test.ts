import { describe, it, expect } from "vitest";

import { TEACH_COMMANDS, type TeachCommand } from "@/features/workspace/ai/commands";

/**
 * `commands.ts` is a pure DATA module: one `TeachCommand` interface and the
 * `TEACH_COMMANDS` constant (the 9 student-interrupt chips). It has NO functions,
 * NO conditionals/ternaries/`&&`/`||`, and NO I/O edge — so there is deliberately
 * nothing to mock (the "fake only at the I/O boundary" rule has no boundary to
 * apply to here). A hard test for a data table therefore asserts the EXACT real
 * contents and the invariants its one consumer (`LearningWorkspace.tsx`) actually
 * depends on:
 *   - `key={c.id}`            → ids MUST be unique (React key correctness)
 *   - `onClick={sendCommand(c.id)}` → each id is a load-bearing BACKEND command
 *                                     string; a typo silently mis-routes teaching
 *   - `{c.label}`             → the exact visible chip text
 *   - `TEACH_COMMANDS.map(...)` renders in array order → order is meaningful
 *
 * Every assertion names the expected value and asserts THAT. These tests go red on
 * any realistic regression: a dropped/added command, a reordering, a renamed label,
 * a changed/duplicated id, or a stray extra key on an entry.
 */

/** The exact, ordered source of truth this test guards. Any drift here is a real change. */
const EXPECTED: ReadonlyArray<{ id: string; label: string }> = [
  { id: "again", label: "Explain again" },
  { id: "simpler", label: "Simpler" },
  { id: "harder", label: "Harder" },
  { id: "example", label: "Another example" },
  { id: "visual", label: "Show visually" },
  { id: "why", label: "Why?" },
  { id: "how", label: "How?" },
  { id: "whatif", label: "What if?" },
  { id: "continue", label: "Continue" },
];

describe("TEACH_COMMANDS — exact contents", () => {
  it("deep-equals the full ordered command list (id + label for every entry)", () => {
    // Strongest single assertion: order + every id + every label, nothing more, nothing less.
    expect(TEACH_COMMANDS).toEqual(EXPECTED);
  });

  it("is a real array of exactly 9 commands", () => {
    expect(Array.isArray(TEACH_COMMANDS)).toBe(true);
    expect(TEACH_COMMANDS).toHaveLength(9);
    expect(TEACH_COMMANDS.length).toBe(EXPECTED.length);
  });

  it("preserves order: 'again' is first and 'continue' is last (render order is meaningful)", () => {
    expect(TEACH_COMMANDS[0]).toEqual({ id: "again", label: "Explain again" });
    expect(TEACH_COMMANDS.at(-1)).toEqual({ id: "continue", label: "Continue" });
  });

  it("exposes the exact ordered id sequence dispatched to the backend", () => {
    expect(TEACH_COMMANDS.map((c) => c.id)).toEqual([
      "again",
      "simpler",
      "harder",
      "example",
      "visual",
      "why",
      "how",
      "whatif",
      "continue",
    ]);
  });

  it("exposes the exact ordered visible chip labels", () => {
    expect(TEACH_COMMANDS.map((c) => c.label)).toEqual([
      "Explain again",
      "Simpler",
      "Harder",
      "Another example",
      "Show visually",
      "Why?",
      "How?",
      "What if?",
      "Continue",
    ]);
  });
});

describe("TEACH_COMMANDS — per-command id → label mapping", () => {
  // One case per entry so a single mislabeled command is pinpointed, not hidden in a bulk diff.
  it.each(EXPECTED)("command '$id' has label '$label'", ({ id, label }) => {
    const found = TEACH_COMMANDS.find((c) => c.id === id);
    expect(found, `command with id '${id}' must exist`).toBeDefined();
    expect(found).toEqual({ id, label });
  });
});

describe("TEACH_COMMANDS — structural invariants the UI relies on", () => {
  it("every entry has exactly the keys {id, label} — no extra/missing keys", () => {
    for (const c of TEACH_COMMANDS) {
      expect(Object.keys(c).sort()).toEqual(["id", "label"]);
    }
  });

  it("every id and label is a non-empty, trimmed string", () => {
    for (const c of TEACH_COMMANDS) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.id).toBe(c.id.trim());
      expect(c.label).toBe(c.label.trim());
    }
  });

  it("ids are unique — required for React keys AND unambiguous backend routing", () => {
    const ids = TEACH_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids).size).toBe(9);
  });

  it("labels are unique — no two chips render identical text", () => {
    const labels = TEACH_COMMANDS.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("ids are lowercase, alphabetic slugs (safe, stable command tokens)", () => {
    for (const c of TEACH_COMMANDS) {
      expect(c.id).toMatch(/^[a-z]+$/);
    }
  });
});

describe("TEACH_COMMANDS — type conformance", () => {
  it("each entry satisfies the exported TeachCommand shape at runtime", () => {
    // Compile-time: assigning through TeachCommand keeps the test type-clean and
    // would fail `tsc` if the interface shape drifted. Runtime: values still checked.
    for (const c of TEACH_COMMANDS) {
      const typed: TeachCommand = c;
      expect(typed.id).toBe(c.id);
      expect(typed.label).toBe(c.label);
    }
  });
});
