/**
 * Observation-store types (L6, §17.1). This subtree is SEPARATE from knowledge — it may
 * import knowledge *types* for shared shapes, but never `knowledge/store` (W4): knowledge and
 * observation live in separate databases and are never joined. An Observation is an
 * append-only fact about a moment; mastery and efficacy are pure queries over these, with no
 * stored conclusion (§20.2, §13.4).
 */
export interface Observation {
  id: string;
  learnerId: string;
  taskId: string | null;
  conceptIds: string[];
  contextId: string; // REQUIRED — makes a future concept SPLIT resolvable (§20.3)
  outcome: { success: boolean; score?: number; [k: string]: unknown };
  bloomLevel: string | null;
  assetIds: string[];
  releaseId: string;
  occurredAt: Date;
}

export interface NewObservation {
  learnerId: string;
  taskId?: string;
  conceptIds: string[];
  contextId: string; // REQUIRED at the type level — an observation with no context is unapportionable
  outcome: { success: boolean; score?: number; [k: string]: unknown };
  bloomLevel?: string;
  assetIds?: string[];
  releaseId: string;
  occurredAt?: Date;
}

/** A mastery estimate — a RESULT, never a stored row (§20.2). */
export interface MasteryEstimate {
  learnerId: string;
  conceptId: string;
  estimate: number; // 0..1 — naive success rate in Phase 2 (no decay, no BKT — that's later)
  observations: number; // how much evidence backs the estimate
  atBloom: string | null;
}

/** An efficacy estimate — derived from observations (§13.4), never authored. */
export interface EfficacyEstimate {
  assetId: string;
  contextId: string | null;
  exposures: number;
  subsequentSuccess: number;
  rate: number;
}
