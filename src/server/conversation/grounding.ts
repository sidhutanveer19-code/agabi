import { defaultOutline, pickVisualFor, type OutlineSlot } from "@/server/conversation/outline";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { resolve } from "@/server/knowledge/search";
import { selectPath } from "@/server/knowledge/path";
import { assetsFor, withCapability } from "@/server/knowledge/teaching/select";
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
  assetCount: number; // teaching assets folded in; 0 ⇒ a teaching.miss (§13.1)
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
  let assetCount = 0;
  for (const conceptId of plan.concepts.slice(0, MAX_CONCEPT_SLOTS)) {
    const concept = await store.getConcept(conceptId, "PUBLIC");
    const name = concept?.name ?? conceptId;
    const facts = await store.statementsForSubject(conceptId, "PUBLIC", policy);
    const fact = facts[0]?.text;

    // M7 — teaching assets are the product (§13.1). A misconception to pre-empt, then an
    // analogy, informs the slot intent (via the existing intent seam, ADR-7). Selection is by
    // CAPABILITY, never by kind (§18C.1).
    const { assets } = await assetsFor(store, [conceptId], "PUBLIC", policy);
    assetCount += assets.length;
    const corrective = withCapability(assets, "corrective")[0];
    const analogical = withCapability(assets, "analogical")[0];
    const teach = corrective
      ? ` First correct the misconception: ${String(corrective.payload.misconception)} — actually, ${String(corrective.payload.correction)}.`
      : analogical
        ? ` Use the analogy: ${String(analogical.payload.source)} (breaks down at: ${String(analogical.payload.breakdownPoint)}).`
        : "";

    const type = n % 3 === 0 ? pickVisualFor(name) : "paragraph";
    const base = fact ? `explain ${name}: ${fact}` : `explain ${name}`;
    slots.push({ slot: n, type, intent: base + teach });
    n++;
  }
  slots.push({ slot: n, type: "summary", intent: `recap of ${topic}` });

  return { outline: slots, conceptIds: plan.concepts, promptVersion: GROUNDED_PROMPT_VERSION, assetCount };
}

/**
 * The one decision the call site makes (§8.2): grounded outline if we have one, else the
 * Phase-1 default. With `grounded = null` (flag off, or a miss) this is EXACTLY
 * `defaultOutline(topic)` — the byte-identical guarantee that makes rollback safe.
 */
export function chooseOutline(topic: string, grounded: GroundedOutline | null): OutlineSlot[] {
  return grounded ? grounded.outline : defaultOutline(topic);
}

// ── Phase 2 (amendment A-7): source-retrieval grounding ──────────────────────────────────────
// Teach from the retrieved TEXTBOOK PASSAGE, not from a graph fact. Read + present only — this path
// NEVER writes the knowledge graph (A-7 invariant). It grounds a lesson on real NCERT/Exemplar text
// (via `searchChunks`, §15 rung 4) and hands the model a strict "rewrite this in the simplest words,
// add an analogy, cite the source, do NOT copy" contract per slot — that contract is what makes the
// lesson non-generic and worth money, vs a raw-LLM wall of text.
export const SOURCE_PROMPT_VERSION = "source-grounded@1";
const MAX_PASSAGE_SLOTS = 4;
const PASSAGE_CHARS = 480; // cap a passage fed into a slot intent — enough to teach, not a page dump

export async function sourceGroundedOutline(
  store: KnowledgeStore,
  topic: string,
  opts: { limit?: number } = {},
): Promise<GroundedOutline | null> {
  const hits = await store.searchChunks(topic, { limit: opts.limit ?? 6 });
  if (!hits.length) return null; // no textbook passage covers it → caller falls back (Phase 3: web)

  const passages = hits.slice(0, MAX_PASSAGE_SLOTS);
  const titleFor = async (sourceId: string) => (await store.getSource(sourceId))?.title ?? "NCERT";

  const slots: OutlineSlot[] = [
    { slot: 1, type: "heading", intent: topic },
    {
      slot: 2,
      type: "paragraph",
      intent: `In the simplest, plainest words, say what ${topic} is and why it matters to a Class-10 student. Rewrite for clarity — do not copy the textbook.`,
    },
  ];

  let n = 3;
  for (const hit of passages) {
    const title = await titleFor(hit.chunk.sourceId);
    const passage = hit.chunk.text.slice(0, PASSAGE_CHARS).trim();
    // Alternate a visual and a prose slot so the lesson is block-structured, never a prose wall.
    const type = n % 2 === 1 ? pickVisualFor(passage) : "paragraph";
    slots.push({
      slot: n,
      type,
      intent:
        `Teach this by REWRITING the following textbook passage in the simplest, clearest words for a ` +
        `Class-10 student — add one everyday analogy, keep it accurate, and do NOT copy it verbatim. ` +
        `Cite the source as "${title}". Passage: "${passage}"`,
    });
    n++;
  }

  slots.push({
    slot: n,
    type: "summary",
    intent: `Recap ${topic} in one or two plain sentences a student would actually remember. Source: NCERT.`,
  });

  // conceptIds empty: this path does not touch the graph. assetCount 0: no teaching assets (M7).
  return { outline: slots, conceptIds: [], promptVersion: SOURCE_PROMPT_VERSION, assetCount: 0 };
}
