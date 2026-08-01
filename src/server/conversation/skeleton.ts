import { coerceSlot } from "@/server/conversation/coerce";
import { isText, type OutlineSlot } from "@/server/conversation/outline";

/**
 * Skeleton-first: the whole lesson goes on screen instantly as minimal shells, in
 * slot order, BEFORE any model call. Content patches in per slot as it resolves
 * (patch.index === slot - 1). A slot that never resolves simply keeps its shell —
 * already a valid minimal visual, never a hole.
 *
 * Text shells are blank (heading is the one the server already knows: the topic).
 * Visual shells reuse the RUNG-5 minimal shapes from coerce.ts — never empty data.
 */
export interface SkeletonBlock {
  type: string;
  data: Record<string, unknown>;
  streamText?: string;
}

/** All N skeleton blocks in slot order. `type` is the FINAL type: coerce may
 *  downgrade a visual it can't natively build (e.g. flow/map → mindmap), and that
 *  resolved type becomes the slot's locked type — the fill rungs target it and
 *  `patch` only ever updates `data`.
 *
 *  The visual placeholder label is the TOPIC, never `s.intent`. `intent` is a MODEL
 *  DIRECTIVE (e.g. "TEACH — do NOT restate…" from buildGroundedOutline) and is used
 *  only as the model prompt in manager.fillSlots — feeding it here leaked the raw
 *  prompt onto the canvas whenever a slot failed to fill (R4). */
export function buildSkeleton(outline: OutlineSlot[], topic: string): SkeletonBlock[] {
  return outline.map((s) => {
    if (s.type === "heading" || s.type === "subheading") return { type: s.type, data: { text: topic }, streamText: topic };
    if (isText(s.type)) return { type: s.type, data: { text: "" }, streamText: "" };
    const c = coerceSlot(s.type, {}, "", topic); // label = topic (NEVER the intent — see note above)
    return { type: c.type, data: c.data };
  });
}
