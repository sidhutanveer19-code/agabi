import { defaultOutline, pickVisualFor, type OutlineSlot } from "@/server/conversation/outline";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { resolve } from "@/server/knowledge/search";
import { selectPath } from "@/server/knowledge/path";
import { POLICIES } from "@/server/knowledge/trust/policy";
import type { TrustPolicy } from "@/server/knowledge/types";

/**
 * The M5 teaching bridge (§8.2). Turns a topic into a GROUNDED outline seeded by the real,
 * prerequisite-ordered concepts from the knowledge graph — and, per the falsifiable claim
 * (§5.3), that alone is a MODEST change: the lesson now covers the actual concept sequence
 * and each slot's intent carries a trust-gated fact, but the visual guarantee, skeleton-first
 * rendering and fill ladder are untouched (ADR-7). The big gain is teaching assets (M7).
 *
 * Grounding NEVER kills a lesson: any failure falls back to the ungrounded default outline.
 * The flag (KNOWLEDGE_GROUNDING) gates the whole thing; when off, `chooseOutline` returns the
 * Phase-1 default byte-for-byte.
 */
export const GROUNDED_PROMPT_VERSION = "grounded-outline@1";

/** A student lesson admits general-school-reviewed knowledge (§26.4), labelled below that. */
const STUDENT_POLICY: TrustPolicy = POLICIES.GENERAL_SCHOOL;
const BUDGET = { maxConcepts: 8 };
const MAX_CONCEPT_SLOTS = 6;

export interface GroundedOutline {
  outline: OutlineSlot[];
  conceptIds: string[];
  promptVersion: string;
}

/** The production knowledge store (Postgres). Lazily built; only reached when the flag is on. */
let _store: KnowledgeStore | null = null;
export function defaultKnowledgeStore(): KnowledgeStore {
  return (_store ??= createPostgresStore());
}

/**
 * Build a grounded outline from the graph, or null if nothing covers the topic (a MISS —
 * the caller falls back to the default outline and emits knowledge.miss). Pure over the
 * injected store, so it is testable against the in-memory store.
 */
export async function groundedOutline(
  store: KnowledgeStore,
  topic: string,
  policy: TrustPolicy = STUDENT_POLICY,
): Promise<GroundedOutline | null> {
  const hits = await resolve(store, { text: topic, trustPolicy: policy });
  if (!hits.length) return null;

  const plan = await selectPath(store, { seeds: hits.map((h) => h.conceptId), policy, budget: BUDGET });
  if (!plan.concepts.length) return null;

  const slots: OutlineSlot[] = [
    { slot: 1, type: "heading", intent: topic },
    { slot: 2, type: "paragraph", intent: `what ${topic} is and why it matters` },
  ];
  let n = 3;
  for (const conceptId of plan.concepts.slice(0, MAX_CONCEPT_SLOTS)) {
    const concept = await store.getConcept(conceptId, "PUBLIC");
    const name = concept?.name ?? conceptId;
    const facts = await store.statementsForSubject(conceptId, "PUBLIC", policy);
    const fact = facts[0]?.text;
    // every 3rd slot a visual (repairOutline still guarantees the minimum regardless)
    const type = n % 3 === 0 ? pickVisualFor(name) : "paragraph";
    slots.push({ slot: n, type, intent: fact ? `explain ${name}: ${fact}` : `explain ${name}` });
    n++;
  }
  slots.push({ slot: n, type: "summary", intent: `recap of ${topic}` });

  return { outline: slots, conceptIds: plan.concepts, promptVersion: GROUNDED_PROMPT_VERSION };
}

/**
 * The one decision the call site makes (§8.2): grounded outline if we have one, else the
 * Phase-1 default. With `grounded = null` (flag off, or a miss) this is EXACTLY
 * `defaultOutline(topic)` — the byte-identical guarantee that makes rollback safe.
 */
export function chooseOutline(topic: string, grounded: GroundedOutline | null): OutlineSlot[] {
  return grounded ? grounded.outline : defaultOutline(topic);
}
