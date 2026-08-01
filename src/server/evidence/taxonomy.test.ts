import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TAXONOMY, tierFor } from "@/server/evidence/taxonomy";
import { EVENTS } from "@/server/events";

// Inlined (architecture.test's walk() is local, not exported).
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}
// grep BOTH src/server and src/app — some events (e.g. workspace.saved) fire in a route.
const SRC = [...walk(join(process.cwd(), "src", "server")), ...walk(join(process.cwd(), "src", "app"))]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("taxonomy — every event justifies its existence", () => {
  it("every declared event names at least one consumer + a question", () => {
    for (const [key, d] of Object.entries(TAXONOMY)) {
      expect(d.consumers.length, `${key} has no consumer`).toBeGreaterThan(0);
      expect(d.question.length, `${key} has no question`).toBeGreaterThan(0);
    }
  });

  it("RECIPROCAL: every declared event is actually emitted (or none-yet + activatesIn)", () => {
    for (const [key, d] of Object.entries(TAXONOMY)) {
      if (d.emitter === "none-yet") {
        expect(d.activatesIn, `${key} is none-yet but has no activatesIn`).toBeTruthy();
        continue;
      }
      expect(SRC, `EVENTS.${key} is declared (emitter=${d.emitter}) but never emitted`).toContain(`EVENTS.${key}`);
    }
  });

  it("every TAXONOMY key exists in EVENTS with the same wire value", () => {
    for (const [key, d] of Object.entries(TAXONOMY)) {
      expect(EVENTS[key as keyof typeof EVENTS], `EVENTS.${key} missing`).toBe(d.value);
    }
  });

  it("tierFor resolves declared values and defaults unknowns to 2", () => {
    expect(tierFor("lesson.started")).toBe(1);
    expect(tierFor("slot.filled")).toBe(2);
    expect(tierFor("workspace.saved")).toBe(3);
    expect(tierFor("nope.unknown")).toBe(2);
  });
});
