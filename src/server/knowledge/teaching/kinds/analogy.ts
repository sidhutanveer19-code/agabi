import type { AssetKindDef } from "@/server/knowledge/teaching/registry";
import { v14AnalogyBreakdown } from "@/server/knowledge/validators/structure";
import { pass } from "@/server/knowledge/validators/types";

/**
 * ANALOGY (§13.2, §13.3) — a mapping from a familiar thing to the target. Capabilities:
 * `analogical`, `explanatory`. Every analogy is wrong somewhere; taught without its limit it
 * INSTALLS a misconception (the learner extends the mapping past where it holds). So a
 * breakdownPoint is MANDATORY (V14) — enforced by schema, not convention, and impossible to
 * retrofit across thousands of assets.
 */
export const analogyKind: AssetKindDef = {
  kind: "ANALOGY",
  capabilities: ["analogical", "explanatory"],
  requiredPayloadFields: ["source", "mapping", "breakdownPoint"],
  validate(payload) {
    const has = (k: string) => typeof payload[k] === "string" && (payload[k] as string).trim().length > 0;
    if (!has("source") || !has("mapping")) {
      return { validator: "V2", outcome: "discard", reason: "ANALOGY_NEEDS_SOURCE_AND_MAPPING" };
    }
    // The load-bearing gate: breakdownPoint (V14).
    const v14 = v14AnalogyBreakdown({ kind: "ANALOGY", payload });
    return v14.outcome === "pass" ? pass("V14") : v14;
  },
};
