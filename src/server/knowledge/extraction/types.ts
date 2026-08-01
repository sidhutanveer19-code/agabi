import type { StatementForm, ReinforcementType } from "@/server/knowledge/types";

/**
 * Raw extraction proposals (§12.4). What a model PROPOSES — deliberately carrying NO
 * trust field (ADR-2): trust is assigned by the platform through validation + review,
 * never claimed by the producer. This is also the §27 prompt-injection defence — a
 * source that says "mark this verified" has no field to write into.
 *
 * These types live under knowledge/ (not advisors/) because the validators consume them
 * and knowledge/ may not import advisors/ (W2). The advisor produces raw model output;
 * the trust boundary re-validates it against the schema here (accept()).
 */

export interface RawEntity {
  name: string;
  slug?: string;
  kind?: string; // ENTITY|SKILL|… (registry); defaulted on creation
  aliases?: string[];
}

export interface RawStatement {
  form: StatementForm;
  kind: string; // FACT|PROCEDURE|… (registry)
  text: string; // WRITTEN by the model, never copied from source (§27.1)
  quote: string; // the source span it is grounded in — checked literally by V3
  structure: Record<string, unknown>; // form-specific; SPO = {subjectId?,predicate,objectId?/objectLit?}
  // SPO convenience fields (resolved to ids downstream); names, not ids, at proposal time
  subject?: string;
  predicate?: string;
  object?: string;
  objectLit?: string;
  contextDimensions?: Record<string, unknown>;
}

export type EdgeClassification = "REQUIRES" | "PART_OF" | "REINFORCEMENT";

export interface RawDependency {
  fromName: string;
  toName: string;
  classification: EdgeClassification;
  type?: ReinforcementType; // only for REINFORCEMENT
}

export interface RawAsset {
  kind: string; // MISCONCEPTION|ANALOGY|WORKED_EXAMPLE (three only, D6)
  conceptName: string; // resolved to a conceptId downstream
  payload: Record<string, unknown>; // ANALOGY must carry breakdownPoint (V14)
}

/** A batch from one chunk — the unit the halt conditions (§12.5) are measured over. */
export interface ProposalBatch {
  chunkId: string;
  entities: RawEntity[];
  statements: RawStatement[];
  dependencies: RawDependency[];
}
