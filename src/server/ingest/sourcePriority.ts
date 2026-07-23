/**
 * Source priority (Universal Knowledge Population). A trust ranking over source TYPES — highest
 * authority first — used to order which sources populate the graph first (higher-trust before
 * lower). It is an ORDERING utility, not a stored field: provenance already records the concrete
 * source per statement (§27.1), and trust itself is assigned by review, never by source type
 * (ADR-2 — a "trusted publisher" can never bypass the trust boundary). This only decides *sequence*.
 */
export const SOURCE_TIERS = [
  "GOVERNMENT_CURRICULUM", // official curriculum authorities
  "OFFICIAL_TEXTBOOK", // e.g. NCERT, when legally supplied
  "PUBLIC_DOMAIN", // public-domain educational sources
  "ENCYCLOPEDIA", // Britannica and peers
  "ACADEMIC", // peer-reviewed / academic sources
  "EDUCATIONAL_WEBSITE", // high-quality educational sites
  "BACKGROUND", // Wikipedia and the like — background only
] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

/** Rank of a tier — lower is higher trust (0 = government curriculum). */
export function sourceRank(tier: SourceTier): number {
  return SOURCE_TIERS.indexOf(tier);
}

/** Comparator to sort sources highest-trust first. Unknown/undefined tiers sort last. */
export function compareTiers(a: SourceTier | undefined, b: SourceTier | undefined): number {
  const ra = a ? sourceRank(a) : SOURCE_TIERS.length;
  const rb = b ? sourceRank(b) : SOURCE_TIERS.length;
  return ra - rb;
}
