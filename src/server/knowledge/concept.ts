import type { Concept, ConceptAlias, SlugResolution } from "@/server/knowledge/types";
import { mintId, slugify } from "@/server/knowledge/ids";

/**
 * Concept identity operations (§18A, §20.3). Pure functions over provided lookups so
 * they are store-agnostic and directly testable — the store wires its own collections in.
 */

export interface ConceptLookup {
  byId(id: string): Concept | undefined;
  bySlug(slug: string): Concept | undefined;
  /** conceptId whose FORMER_NAME alias equals `slug`, if any (§18A.3). */
  formerName(slug: string): string | undefined;
}

/** Mint a fresh concept row. Id is A-1 (opaque); slug is derived and MUTABLE (§18A). */
export function buildConcept(input: {
  name: string;
  slug?: string;
  kind?: string;
  scope?: Concept["scope"];
  status?: Concept["status"];
}): Concept {
  return {
    id: mintId(),
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    kind: input.kind ?? "ENTITY",
    scope: input.scope ?? "PUBLIC",
    status: input.status ?? "DRAFT",
    version: 1,
    supersedes: null,
    mergedInto: null,
    splitInto: [],
    createdAt: new Date(),
  };
}

/**
 * Resolve a slug to a concept id, following tombstones (§18A.4):
 *   1. current slug   2. FORMER_NAME alias   3. mergedInto chain (bounded)
 *   4. splitInto set → AMBIGUOUS (honest, not wrong — §20.3 step 5)
 * A merged concept's id resolves forever; a split concept resolves honestly-ambiguous.
 */
export function resolveSlug(slug: string, lookup: ConceptLookup, maxHops = 32): SlugResolution {
  let concept = lookup.bySlug(slug);
  if (!concept) {
    const formerId = lookup.formerName(slug);
    if (formerId) concept = lookup.byId(formerId);
  }
  if (!concept) return { kind: "none" };
  return resolveConcept(concept, lookup, maxHops);
}

/** Follow a concept through merge/split tombstones to its live identity (or ambiguity). */
export function resolveConcept(start: Concept, lookup: ConceptLookup, maxHops = 32): SlugResolution {
  let concept: Concept | undefined = start;
  const seen = new Set<string>();
  for (let hop = 0; hop < maxHops && concept; hop++) {
    if (seen.has(concept.id)) break; // guard: a malformed tombstone loop terminates
    seen.add(concept.id);
    if (concept.splitInto.length > 0) return { kind: "ambiguous", candidates: [...concept.splitInto] };
    if (concept.mergedInto) {
      concept = lookup.byId(concept.mergedInto);
      continue;
    }
    return { kind: "concept", conceptId: concept.id };
  }
  return concept ? { kind: "concept", conceptId: concept.id } : { kind: "none" };
}

/**
 * The tombstone half of a MERGE (§20.3): the loser points at the winner and its id
 * resolves forever. Full re-attribution of statements/edges/assets/mappings is the
 * review operation built at M6; here we produce the non-destructive tombstone record
 * plus the FORMER_NAME alias that keeps the loser's slug resolving.
 */
export function mergeTombstone(loser: Concept, winnerId: string): { concept: Concept; alias: ConceptAlias } {
  return {
    concept: { ...loser, status: "MERGED", mergedInto: winnerId },
    alias: { conceptId: winnerId, alias: loser.slug, language: "en", kind: "FORMER_NAME" },
  };
}

/**
 * The tombstone half of a SPLIT (§20.3 step 5): the source resolves AMBIGUOUS, since an
 * old reference that did not record its usage context now genuinely means two things.
 * Re-attribution and observation apportionment (by contextId) are the M6 review op.
 */
export function splitTombstone(source: Concept, targetIds: string[]): Concept {
  return { ...source, status: "SPLIT", splitInto: [...targetIds] };
}

/**
 * Rename: the new slug becomes current; the old slug is retained as a FORMER_NAME alias
 * so existing links keep resolving (§18A.3). Ids never change (the `identity` invariant).
 */
export function rename(concept: Concept, newName: string): { concept: Concept; formerAlias: ConceptAlias } {
  const newSlug = slugify(newName);
  return {
    concept: { ...concept, name: newName, slug: newSlug },
    formerAlias: { conceptId: concept.id, alias: concept.slug, language: "en", kind: "FORMER_NAME" },
  };
}
