import type { Provenance } from "@/server/knowledge/types";

/**
 * Corroboration by PUBLISHER independence (§26.6), not by document. Ten copies of the same
 * textbook are one source; two independent publishers stating the same thing is real
 * corroboration. `independentSourceCount` is what the ladder's AUTO_VALIDATED rung requires
 * (≥1, §26.2) and what higher rungs weigh — counting documents instead would let one source,
 * duplicated, masquerade as agreement.
 *
 * The publisher of each provenance is resolved by the caller (Provenance carries a sourceId;
 * the Source carries the publisher). Here we take the resolved publisher per provenance.
 */
export interface CorroborationInput {
  provenanceOf: Provenance[];
  publisherOf: (sourceId: string) => string | undefined;
}

export interface Corroboration {
  corroborationCount: number; // distinct sources
  independentSourceCount: number; // distinct PUBLISHERS
}

export function corroboration(input: CorroborationInput): Corroboration {
  const sources = new Set<string>();
  const publishers = new Set<string>();
  for (const p of input.provenanceOf) {
    sources.add(p.sourceId);
    const publisher = input.publisherOf(p.sourceId);
    if (publisher) publishers.add(publisher);
  }
  return { corroborationCount: sources.size, independentSourceCount: publishers.size };
}
