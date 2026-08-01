import type { RawStatement, RawEntity } from "@/server/knowledge/extraction/types";
import type { DimensionRegistry } from "@/server/knowledge/context/registry";
import { pass, type ValidationResult } from "@/server/knowledge/validators/types";

/**
 * Structural / registry gates (§14): V2 payload kind, V6 entity resolution, V11 context
 * validity, V12 units, V14 analogy breakdown, V15 self-reference. The genuinely-checkable
 * ones are implemented fully; the ones that need more infrastructure (a full units engine)
 * do the honest basic check and are documented as such — never a silent pass dressed as a
 * complete one.
 */

// A minimal kind registry for V2. The architecture calls these open registries; a fuller
// per-kind payload schema arrives with the asset/assessment layers (M7/M9).
const STATEMENT_KINDS = new Set(["FACT", "PROCEDURE", "PRINCIPLE", "RULE", "DEFINITION", "RELATIONSHIP"]);

/** V2 — payload/kind is registered. Unknown kind → discard (registry-validated). */
export function v2Kind(statement: RawStatement): ValidationResult {
  if (!STATEMENT_KINDS.has(statement.kind)) {
    return { validator: "V2", outcome: "discard", reason: `UNKNOWN_KIND_${statement.kind}` };
  }
  return pass("V2");
}

/** V6 — entity resolution: a name that resolves is fine; an unknown name is FLAGGED as new (not discarded). */
export function v6EntityResolution(entity: RawEntity, resolves: (name: string) => boolean): ValidationResult {
  if (resolves(entity.name)) return pass("V6");
  return { validator: "V6", outcome: "flag", reason: "NEW_ENTITY", detail: entity.name };
}

/** V11 — context validity: every dimension key is registered; validFrom < validUntil if present. */
export function v11ContextValidity(dimensions: Record<string, unknown> | undefined, registry: DimensionRegistry): ValidationResult {
  if (!dimensions) return pass("V11");
  for (const key of Object.keys(dimensions)) {
    if (!(key in registry)) return { validator: "V11", outcome: "discard", reason: `UNREGISTERED_DIMENSION_${key}` };
  }
  const from = dimensions.validFrom;
  const until = dimensions.validUntil;
  if (typeof from === "string" && typeof until === "string" && from >= until) {
    return { validator: "V11", outcome: "discard", reason: "VALID_FROM_NOT_BEFORE_UNTIL" };
  }
  return pass("V11");
}

/**
 * V12 — units / dimensional consistency. Basic honest check: when a statement's structure
 * declares matching `value`+`unit` pairs that disagree, flag it. A full dimensional-analysis
 * engine is deferred; this catches the obvious mismatch and is documented as partial, so a
 * pass here is never mistaken for "dimensionally proven".
 */
export function v12Units(statement: RawStatement): ValidationResult {
  const s = statement.structure;
  if (s && typeof s.unit === "string" && typeof s.expectedUnit === "string" && s.unit !== s.expectedUnit) {
    return { validator: "V12", outcome: "flag", reason: `UNIT_MISMATCH_${s.unit}_vs_${s.expectedUnit}` };
  }
  return pass("V12");
}

/**
 * V14 — analogy breakdown (§13.3). Every ANALOGY must state where it fails, or it installs a
 * misconception. Enforced against an asset-like `{kind, payload}` (used by the asset layer, M7).
 */
export function v14AnalogyBreakdown(asset: { kind: string; payload: Record<string, unknown> }): ValidationResult {
  if (asset.kind !== "ANALOGY") return pass("V14");
  const bp = asset.payload?.breakdownPoint;
  if (typeof bp !== "string" || bp.trim().length === 0) {
    return { validator: "V14", outcome: "discard", reason: "ANALOGY_MISSING_BREAKDOWN_POINT" };
  }
  return pass("V14");
}

/** V15 — self-reference: for an SPO statement, subject ≠ object. */
export function v15SelfReference(statement: RawStatement): ValidationResult {
  if (statement.form !== "SPO") return pass("V15");
  const subj = statement.subject ?? (statement.structure.subjectId as string | undefined);
  const obj = statement.object ?? (statement.structure.objectId as string | undefined);
  if (subj && obj && subj === obj) {
    return { validator: "V15", outcome: "discard", reason: "SUBJECT_EQUALS_OBJECT" };
  }
  return pass("V15");
}
