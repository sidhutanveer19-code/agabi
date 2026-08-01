import type { Doc } from "@/server/ingest/spans";
import type { RawSource } from "@/server/ingest/connector";

/**
 * Curriculum-discovery contract (W2). Discovery answers ONLY "what is this document and
 * where is everything located?" — pure structure, never meaning. No concepts, relationships,
 * prerequisites, difficulty, objectives, or assets are produced here (those are later stages).
 *
 * This file is the seam: the orchestrator (W1) depends on the TYPE + the `Discover` function
 * shape; the detector that produces a real hierarchy is W2 (`discovery/hierarchy.ts`, profile-
 * driven). Until then the orchestrator runs with discovery omitted (hierarchy = null).
 */

/** One structural node — a chapter, section, subsection, or topic — and where it lives. */
export interface HierarchyNode {
  level: "book" | "chapter" | "section" | "subsection" | "topic";
  title: string;
  span: [number, number]; // source character range this node covers
  page: number;
  children: HierarchyNode[];
}

export interface DocumentHierarchy {
  subject: string | null; // detected subject, or null when a profile can't decide (structure only)
  profile: string; // which CurriculumProfile made the call (or "generic")
  nodes: HierarchyNode[]; // top-level chapters/books, recursively nested
}

/** A discovery function: pure, deterministic, structure-only. Injected into the orchestrator. */
export type Discover = (doc: Doc, source: RawSource) => DocumentHierarchy;
