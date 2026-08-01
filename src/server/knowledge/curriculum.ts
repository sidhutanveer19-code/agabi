import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { Mapping } from "@/server/knowledge/types";

/**
 * Curriculum (§10 L5, L7). Curriculum is a MAPPING LAYER on top of the graph — knowledge
 * never references it. Dropping every program leaves the graph fully teachable
 * (`curriculum-independence`), which is what lets one concept graph serve many boards without
 * a per-board rebuild. These are thin reads over the mapping store; the graph does not know
 * they exist.
 */

/** Which curricula reference this concept, and at what depth (INTRODUCE…MASTER). */
export async function curriculumFor(store: KnowledgeStore, conceptId: string): Promise<Mapping[]> {
  return store.mappingsForConcept(conceptId);
}

/** Which concepts a program node maps to (e.g. a syllabus unit → its concepts). */
export async function conceptsUnder(store: KnowledgeStore, programNodeId: string): Promise<Mapping[]> {
  return store.mappingsUnderNode(programNodeId);
}
