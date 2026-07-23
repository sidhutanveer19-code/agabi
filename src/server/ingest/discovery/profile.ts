import type { HierarchyNode } from "@/server/ingest/discovery/types";

/**
 * Curriculum profiles (W2) — the "curriculum is DATA, not code" seam. A profile says how a
 * document's raw structure maps to a curriculum hierarchy: which markdown heading level is a
 * chapter vs a section, and (optionally) deterministic rules to name the subject. Adding CBSE /
 * JEE / NEET / IB later is **a new profile file registered here — never an engine change** (the
 * same open-registry pattern the platform uses for context dimensions and blocks).
 *
 * Profiles carry NO semantic meaning (no concepts/objectives/difficulty) — discovery answers only
 * "what is this document and where is everything located?".
 */
export interface CurriculumProfile {
  id: string;
  name: string;
  /** markdown heading level (1–6) → structural level. */
  headingMap: Record<number, HierarchyNode["level"]>;
  /** deterministic subject naming from the top heading — first match wins; omitted → subject null. */
  subjectRules?: { pattern: RegExp; subject: string }[];
}

const PROFILES = new Map<string, CurriculumProfile>();

export function registerProfile(p: CurriculumProfile): void {
  PROFILES.set(p.id, p);
}
export function getProfile(id: string): CurriculumProfile | undefined {
  return PROFILES.get(id);
}
export function listProfiles(): CurriculumProfile[] {
  return [...PROFILES.values()];
}

/** The default profile — generic document structure, no subject opinion. Always available. */
export const GENERIC_PROFILE: CurriculumProfile = {
  id: "generic",
  name: "Generic document structure",
  headingMap: { 1: "chapter", 2: "section", 3: "subsection", 4: "topic", 5: "topic", 6: "topic" },
};
registerProfile(GENERIC_PROFILE);
