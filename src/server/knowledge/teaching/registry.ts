import type { ValidationResult } from "@/server/knowledge/validators/types";
import { misconceptionKind } from "@/server/knowledge/teaching/kinds/misconception";
import { analogyKind } from "@/server/knowledge/teaching/kinds/analogy";
import { workedExampleKind } from "@/server/knowledge/teaching/kinds/workedExample";

/**
 * The teaching-asset registry (§13.2, §18C.1). Consumers must NEVER switch on `kind` — that
 * puts domain knowledge in the Teaching Engine and makes adding a type require changing it.
 * Instead each kind declares CAPABILITIES, and consumers ask "is this corrective?" /
 * "is this demonstrable?", never "is this a MISCONCEPTION?". A fourth kind is a new registry
 * entry, not a new `if`.
 *
 * Phase 2 populates THREE kinds only (§13.5, D6): twenty-plus kinds against no source
 * material would be twenty-plus guesses.
 */
export type AssetCapability = "explanatory" | "corrective" | "demonstrable" | "analogical";

export interface AssetKindDef {
  kind: string;
  capabilities: AssetCapability[];
  requiredPayloadFields: string[];
  validate(payload: Record<string, unknown>): ValidationResult;
}

const REGISTRY: Record<string, AssetKindDef> = {
  MISCONCEPTION: misconceptionKind,
  ANALOGY: analogyKind,
  WORKED_EXAMPLE: workedExampleKind,
};

export const ASSET_KINDS = Object.keys(REGISTRY);

export function assetKind(kind: string): AssetKindDef | undefined {
  return REGISTRY[kind];
}

export function capabilitiesOf(kind: string): AssetCapability[] {
  return REGISTRY[kind]?.capabilities ?? [];
}

/** The capability-dispatch primitive (§18C.1). This is how consumers select assets. */
export function hasCapability(kind: string, capability: AssetCapability): boolean {
  return capabilitiesOf(kind).includes(capability);
}

export function validateAssetPayload(kind: string, payload: Record<string, unknown>): ValidationResult {
  const def = REGISTRY[kind];
  if (!def) return { validator: "V2", outcome: "discard", reason: `UNKNOWN_ASSET_KIND_${kind}` };
  return def.validate(payload);
}
