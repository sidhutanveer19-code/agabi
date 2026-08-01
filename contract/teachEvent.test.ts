import { describe, it, expect } from "vitest";
import { teachEventSchema } from "@contract/schemas";

// The frontend runs teachEventSchema.safeParse on every NDJSON line and DROPS anything
// that fails. The server writes JSON.stringify({ v:1, ...ev }), so a variant missing
// `v: z.literal(1).optional()` fails safeParse and vanishes — the bug that made
// {t:"usage"} a silent no-op. This guards the new `outcome` variant against it.
describe("teach `outcome` event survives the contract", () => {
  it("parses exactly as the server writes it (with v:1)", () => {
    const wire = JSON.parse(JSON.stringify({ v: 1, t: "outcome", outcome: "PARTIAL", failedIndices: [3, 5], plannedCount: 7, readyCount: 5 }));
    expect(teachEventSchema.safeParse(wire).success).toBe(true);
  });

  it("COMPLETE and FAILED also parse", () => {
    for (const outcome of ["COMPLETE", "FAILED"]) {
      const wire = { v: 1, t: "outcome", outcome, failedIndices: [], plannedCount: 3, readyCount: 3 };
      expect(teachEventSchema.safeParse(wire).success).toBe(true);
    }
  });
});
