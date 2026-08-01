import type { AssetKindDef } from "@/server/knowledge/teaching/registry";
import { pass } from "@/server/knowledge/validators/types";

/**
 * MISCONCEPTION (§13.2) — names a wrong mental model a learner is likely to hold, so it can be
 * surfaced BEFORE the correct idea lands on top of it. Capability: `corrective`. Requires both
 * the misconception and its correction — a named misconception with no correction just teaches
 * the misconception.
 */
export const misconceptionKind: AssetKindDef = {
  kind: "MISCONCEPTION",
  capabilities: ["corrective"],
  requiredPayloadFields: ["misconception", "correction"],
  validate(payload) {
    const has = (k: string) => typeof payload[k] === "string" && (payload[k] as string).trim().length > 0;
    if (!has("misconception") || !has("correction")) {
      return { validator: "V2", outcome: "discard", reason: "MISCONCEPTION_NEEDS_MISCONCEPTION_AND_CORRECTION" };
    }
    return pass("V2");
  },
};
