/**
 * Engine-agnostic domain types for the knowledge platform. Deliberately NOT derived
 * from `@prisma/client` — the memory store must compile with no Prisma import (wall W5),
 * and the interface is designed against these types so it stays storage-agnostic (§5.1).
 * The Postgres store maps these to/from Prisma rows; nothing else knows Prisma exists.
 */

// ─────────── Trust ladder (§26.1) — a closed, ORDERED ladder ───────────
export const TRUST_LEVELS = [
  "MACHINE_PROPOSED",
  "AUTO_VALIDATED",
  "COMMUNITY_REVIEWED",
  "EXPERT_REVIEWED",
  "OFFICIAL_SOURCE_VERIFIED",
  "AGABI_CANONICAL",
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Rank on the ladder. Higher = more trusted. The ONLY correct way to compare trust. */
export function trustRank(level: TrustLevel): number {
  return TRUST_LEVELS.indexOf(level);
}
/** The floor above which a human ReviewEvent is mandatory (§26.2). */
export const HUMAN_FLOOR: TrustLevel = "AUTO_VALIDATED";

// ─────────── Scope / tenancy (§23) ───────────
export type Scope = "PUBLIC" | `tenant:${string}`;
export function isPublic(scope: string): boolean {
  return scope === "PUBLIC";
}
/** A read scope: a tenant sees its own rows PLUS public; PUBLIC-only sees only public. */
export type ReadScope = "PUBLIC" | `tenant:${string}`;

/**
 * TrustPolicy — architecture §26.4 (this shape wins over BLUEPRINT ADR-6 by the
 * precedence rule: where the two disagree, the architecture is law). Required on every
 * content read, with NO default — omitting it is a compile error, which is how a new
 * call site is forced to make the trust decision explicit rather than inherit one.
 *
 *   minimum    — the floor the caller treats as "trusted enough to teach as fact"
 *   labelBelow — anything below this level MUST be returned labelled, never bare (S3)
 *   refuseBelow — anything below this level is not returned at all
 *
 * The invariant no policy may relax (§26.4): uncertain knowledge is never presented as
 * fact. DISPUTED (§26.5) is never served regardless of policy — a flag, not a rung.
 */
export interface TrustPolicy {
  minimum: TrustLevel;
  labelBelow: TrustLevel;
  refuseBelow: TrustLevel;
}

/** A content row as served: `labelled` set when trustLevel < policy.labelBelow (S3). */
export type Labelled<T> = T & { labelled: boolean };

// ─────────── Statement forms (§10, §14.4) ───────────
export const STATEMENT_FORMS = [
  "SPO",
  "CONDITIONAL",
  "QUANTIFIED",
  "CAUSAL",
  "COMPARATIVE",
  "PROBABILISTIC",
  "DEFINITIONAL",
] as const;
export type StatementForm = (typeof STATEMENT_FORMS)[number];

// ─────────── Reinforcement edge types (§10) — cyclic graph ───────────
export const REINFORCEMENT_TYPES = [
  "ENABLES",
  "REINFORCES",
  "REVISITS",
  "TRANSFER_TO",
  "CO_OCCURS",
  "COMMON_CONFUSION",
  "ANALOGOUS_TO",
  "CONTRASTS",
  "SUCCEEDS",
] as const;
export type ReinforcementType = (typeof REINFORCEMENT_TYPES)[number];

export type ConceptStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "MERGED" | "SPLIT";

// ─────────── Record shapes the store holds ───────────
export interface Concept {
  id: string;
  slug: string;
  name: string;
  kind: string; // ENTITY|SKILL|... open registry
  scope: Scope;
  status: ConceptStatus;
  version: number;
  supersedes: string | null;
  mergedInto: string | null;
  splitInto: string[];
  createdAt: Date;
}

export interface ConceptAlias {
  conceptId: string;
  alias: string;
  language: string;
  kind: string; // SYNONYM|ABBREV|TRANSLATION|MISSPELLING|FORMER_NAME
}

export interface ConceptTag {
  conceptId: string;
  namespace: string;
  value: string;
}

export interface Context {
  id: string; // sha256(canonicalJSON(dimensions))
  dimensions: Record<string, unknown>;
}

export interface Statement {
  id: string;
  kind: string;
  form: StatementForm;
  structure: Record<string, unknown>;
  subjectId: string | null;
  predicate: string | null;
  objectId: string | null;
  objectLit: string | null;
  text: string;
  payload: Record<string, unknown>;
  contextId: string;
  scope: Scope;
  trustLevel: TrustLevel;
  validationMethods: string[];
  corroborationCount: number;
  independentSourceCount: number;
  derivedFrom: string[];
  authority: string | null;
  evidenceLevel: string | null;
  version: number;
  supersedes: string | null;
  createdAt: Date;
  // DISPUTED — a suspension flag, not a rung (§26.5). Never served while true, at any level.
  disputed: boolean;
  disputeReason: string | null;
  disputedAt: Date | null;
  priorTrustLevel: TrustLevel | null;
}

export interface Provenance {
  statementId: string;
  sourceId: string;
  chunkId: string;
  locator: unknown;
  quote: string; // verification ONLY — never served (§27.1)
  extractorVersion: string;
  promptVersion: string;
  modelId: string;
  extractedAt: Date;
}

/**
 * The source a statement traces to, and the chunk it was extracted from (§18A.5). Provenance
 * carries `sourceId`/`chunkId`; without these two rows those ids point at nothing, so grounding
 * cannot be re-checked after a run and the review CLI has no passage to show. Persisted by the
 * ingest orchestrator before any extraction, so a provenance write always resolves.
 */
export interface Source {
  id: string;
  kind: string;
  title: string;
  publisher: string;
  authority: string;
  edition: string | null;
  publishedAt: Date | null;
  uri: string | null;
  checksum: string; // content hash — the source is content-addressed
  license: string;
  licenseUrl: string | null;
  ingestedAt: Date;
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  locator: { page: number; range: [number, number] };
  text: string; // normalised passage — what the reviewer reads and V3 re-checks against
  ordinal: number;
}

export interface DependencyEdge {
  fromId: string;
  toId: string;
  strength: number;
  contextId: string | null;
  version: number;
  supersedes: string | null;
}

export interface CompositionEdge {
  partId: string;
  wholeId: string;
  ordinal: number | null;
  version: number;
}

export interface ReinforcementEdge {
  fromId: string;
  toId: string;
  type: ReinforcementType;
  strength: number;
  earned: boolean;
  contextId: string | null;
  version: number;
}

export interface ReviewEvent {
  id: string;
  targetKind: string;
  targetId: string;
  decision: string; // APPROVE|REJECT|EDIT|MERGE|SPLIT|DISPUTE|PROMOTE|DEMOTE
  fromTrust: TrustLevel | null;
  toTrust: TrustLevel | null;
  actorId: string; // a human. always.
  before: unknown;
  after: unknown;
  reason: string | null;
  batchId: string | null;
  createdAt: Date;
}

/** What a review decision persists to the target, computed by review/decide (§26). */
export interface ReviewEffect {
  targetKind: string;
  targetId: string;
  trustLevel?: TrustLevel;
  dispute?: { disputed: boolean; reason: string | null; priorTrustLevel: TrustLevel | null; at: Date | null };
}

export interface Release {
  id: string; // YYYY-MM-DD-nn
  label: string;
  createdAt: Date;
  frozen: boolean;
}

export interface ReleaseMember {
  releaseId: string;
  kind: string;
  entityId: string;
}

// ─────────── L4 · Teaching (§10, §13) — the layer that is the product ───────────
export interface TeachingAsset {
  id: string;
  kind: string; // MISCONCEPTION|ANALOGY|WORKED_EXAMPLE (three only in Phase 2, D6)
  conceptId: string;
  statementId: string | null;
  payload: Record<string, unknown>; // ANALOGY MUST carry breakdownPoint (V14)
  contextId: string;
  trustLevel: TrustLevel;
  scope: Scope;
  version: number;
  supersedes: string | null;
}

/** Efficacy is DERIVED from observation, never authored (§13.4) — no quality column. */
export interface AssetEfficacy {
  assetId: string;
  contextId: string;
  exposures: number;
  subsequentSuccess: number;
  computedAt: Date;
}

// ─────────── Assessment (§10, C3, scheduled M9) ───────────
export interface AssessmentItem {
  id: string;
  kind: string; // MCQ|SHORT|NUMERIC|ORDERING|MATCHING|ARTIFACT|CODE
  prompt: string;
  payload: Record<string, unknown>; // MCQ distractors carry diagnosesMisconception
  contextId: string;
  scope: Scope;
  trustLevel: TrustLevel;
  version: number;
  supersedes: string | null;
}

export interface ItemConcept {
  itemId: string;
  conceptId: string;
  role: string;
  bloom: string | null;
}

// ─────────── L5 · Program / curriculum (§10) — a MAPPING layer; knowledge never refs it (L7) ───────────
export interface Program {
  id: string;
  slug: string;
  name: string;
  kind: string; // SCHOOL_BOARD|DEGREE|CERTIFICATION|EXAM|COURSE|INTERNAL
  authority: string;
  jurisdiction: string | null;
  scope: Scope;
  version: string;
}

export interface ProgramNode {
  id: string;
  programId: string;
  parentId: string | null;
  nodeKind: string; // DOMAIN|TRACK|LEVEL|MODULE|UNIT|TOPIC|…
  name: string;
  ordinal: number;
  code: string | null;
}

export interface Mapping {
  programNodeId: string;
  conceptId: string;
  depth: string; // INTRODUCE|DEVELOP|MASTER|REVISE|ASSUMED
  ordinal: number;
  examWeight: number | null;
  required: boolean;
}

/** A derived, rebuildable closure cache entry (ADR-11) — never authoritative. */
export interface ClosureCacheEntry {
  conceptId: string;
  releaseId: string;
  closure: string[]; // ordered prerequisite ids
  computedAt: Date;
}

// ─────────── Traversal (§18B.1) — bounded BY CONSTRUCTION ───────────
export interface TraversalSpec {
  seeds: string[];
  graph: "dependency" | "composition" | "reinforcement";
  direction: "forward" | "reverse";
  maxDepth: number; // REQUIRED. no default meaning infinity.
  maxNodes: number; // REQUIRED. hard stop.
  contextId?: string; // prefer context-matching edges
  at?: string; // ReleaseId
}

export interface TraversalResult {
  nodes: { id: string; depth: number }[];
  truncated: boolean; // §18B.1 — a cap the caller does not know about is a lie
}

/** Split resolution outcome (§18A.4). A split concept resolves honestly-ambiguous. */
export type SlugResolution =
  | { kind: "concept"; conceptId: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };
