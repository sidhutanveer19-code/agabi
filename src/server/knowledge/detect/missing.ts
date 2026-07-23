import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope, TrustPolicy } from "@/server/knowledge/types";
import { coverageReport } from "@/server/knowledge/coverage";

/**
 * Missing-concept detector (W7, gap E-backend). A concept a name was extracted for but about which
 * nothing was asserted is a coverage hole — the input to the "author this" queue. This IS the
 * coverage report's orphan set; the detector is a thin, named view over it (reuse before build).
 * Read-only, derived, deterministic.
 */
export async function missingConcepts(store: KnowledgeStore, scope: ReadScope, policy: TrustPolicy): Promise<string[]> {
  return (await coverageReport(store, scope, policy)).orphanConcepts;
}
