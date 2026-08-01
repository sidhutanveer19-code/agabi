import type { TeachingAsset, Scope } from "@/server/knowledge/types";
import type { ValidationResult } from "@/server/knowledge/validators/types";
import { mintId } from "@/server/knowledge/ids";
import { validateAssetPayload } from "@/server/knowledge/teaching/registry";

/**
 * Build a teaching asset (§13). Like every producer it is created at MACHINE_PROPOSED — trust
 * is the platform's to assign through review, never the author's (ADR-2). Payload validity is
 * kind-specific (V14 for analogies) and returned alongside so the caller can reject before store.
 */
export interface AssetInput {
  kind: string;
  conceptId: string;
  statementId?: string | null;
  payload: Record<string, unknown>;
  contextId: string;
  scope?: Scope;
}

export function buildAsset(input: AssetInput): { asset: TeachingAsset; validation: ValidationResult } {
  const validation = validateAssetPayload(input.kind, input.payload);
  const asset: TeachingAsset = {
    id: mintId(),
    kind: input.kind,
    conceptId: input.conceptId,
    statementId: input.statementId ?? null,
    payload: input.payload,
    contextId: input.contextId,
    trustLevel: "MACHINE_PROPOSED",
    scope: input.scope ?? "PUBLIC",
    version: 1,
    supersedes: null,
  };
  return { asset, validation };
}
