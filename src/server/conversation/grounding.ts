import type { OutlineSlot } from "@/server/conversation/outline";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";

/**
 * Grounding engine (A-7 — a READ + PRESENT-ONLY teaching path beside the graph). It turns
 * retrieved NCERT source passages into a PROBLEM-FIRST grounded lesson outline: a fixed arc
 * that opens with the question the idea answers, then reaches the idea grounded in — and citing —
 * the book's own words. PURE math over passages plus one thin async wrapper at the store read
 * edge; no model call, no write. Two invariants this module encodes:
 *   · The ARC ORDER is fixed (§ buildGroundedOutline): a motivating problem is slot 2 — a
 *     definition can NEVER be slot 2. Passage content fills intents; it never reshapes the arc.
 *   · The store path is read + present only (A-7 / CLAUDE.md Laws 36/37): groundedOutlineFor
 *     calls exactly one read (searchChunks) and no write/put method, so nothing a retrieved
 *     chunk says can enter canonical knowledge.
 */

/** A source passage ready to teach from — the book's words plus where they came from. */
export interface Passage {
  text: string;
  sourceId: string;
  chunkId: string;
  locator: { page: number; range: [number, number] };
}

/**
 * A grounded lesson plan: the fixed problem-first arc, plus `citations` mapping a slot number to
 * the chunkId its intent quotes. `problemFirst` is a literal `true` — a type-level promise that
 * this outline led with the problem, not the definition.
 */
export interface GroundedOutline {
  outline: OutlineSlot[];
  citations: Record<number, string>;
  problemFirst: true;
}

/** The longest snippet of the book's words an intent may quote — short enough to be a snippet, not a copy. */
const SNIPPET_MAX = 120;

/**
 * A short, grounded snippet of a passage: a PREFIX substring of the trimmed text (so it is provably
 * the book's words, never a paraphrase), clipped at a word boundary and capped at SNIPPET_MAX chars.
 * Untrusted source text is quoted as inert data — it is never parsed or acted upon.
 */
function snippetOf(text: string): string {
  const clean = text.trim();
  if (clean.length <= SNIPPET_MAX) return clean;
  const cut = clean.slice(0, SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Build a PROBLEM-FIRST grounded outline from source passages. PURE and deterministic.
 * Returns `null` for empty passages (nothing to ground on). Otherwise emits a FIXED 9-slot arc —
 * this ORDER is the invariant, so a definition never lands in slot 2:
 *   1 heading    → the topic
 *   2 paragraph  → a MOTIVATING PROBLEM the idea answers (not the definition)
 *   3 paragraph  → an analogy / intuition
 *   4 mindmap    → the core idea, CITING + quoting the best passage        (citations[4])
 *   5 paragraph  → a worked example, grounded in another passage if any    (citations[5])
 *   6 paragraph  → what it is, and what it is not
 *   7 paragraph  → why it matters
 *   8 callout    → the common mistake
 *   9 summary    → recap
 * The two factual slots (4, 5) embed a <=120-char snippet of their passage so the lesson is in the
 * book's words; every other slot is a deterministic function of the topic alone.
 */
export function buildGroundedOutline(topic: string, passages: Passage[]): GroundedOutline | null {
  if (passages.length === 0) return null;

  const primary = passages[0];
  const secondary = passages[1] ?? passages[0]; // cite a DIFFERENT passage for the example when available

  const citations: Record<number, string> = {
    4: primary.chunkId,
    5: secondary.chunkId,
  };

  // Role + intent per position; `slot` is assigned by index below so the arc is always 1..9.
  const rows: Array<Pick<OutlineSlot, "type" | "intent">> = [
    { type: "heading", intent: topic },
    { type: "paragraph", intent: `A problem first: why do we need ${topic}, and what problem does it solve?` },
    { type: "paragraph", intent: `An everyday analogy that builds intuition for ${topic} before any formal definition` },
    { type: "mindmap", intent: `The core idea behind ${topic}, grounded in the book: "${snippetOf(primary.text)}"` },
    { type: "paragraph", intent: `A worked example of ${topic}, straight from the book: "${snippetOf(secondary.text)}"` },
    { type: "paragraph", intent: `What ${topic} really is — and, just as important, what it is not` },
    { type: "paragraph", intent: `Why ${topic} matters, and where a student actually meets it` },
    { type: "callout", intent: `The common mistake students make with ${topic}, and how to avoid it` },
    { type: "summary", intent: `Recap of ${topic}: the problem, the core idea, and the example` },
  ];

  const outline: OutlineSlot[] = rows.map((row, i) => ({ slot: i + 1, type: row.type, intent: row.intent }));

  return { outline, citations, problemFirst: true };
}

/**
 * The I/O edge (A-7): retrieve the top source chunks for `topic` and present them as a grounded
 * outline. READ + PRESENT ONLY — it performs exactly one read (searchChunks) and no write, so no
 * retrieved chunk or its rewrite can enter canonical knowledge. Returns `null` when nothing matches.
 */
export async function groundedOutlineFor(
  topic: string,
  store: Pick<KnowledgeStore, "searchChunks">,
): Promise<GroundedOutline | null> {
  const hits = await store.searchChunks(topic, { limit: 6 });
  const passages: Passage[] = hits.map((hit) => ({
    text: hit.chunk.text,
    sourceId: hit.chunk.sourceId,
    chunkId: hit.chunk.id,
    locator: hit.chunk.locator,
  }));
  return buildGroundedOutline(topic, passages);
}
