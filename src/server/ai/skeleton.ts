import { coerceSlot } from "@/server/ai/coerce";
import { isText, type OutlineSlot } from "@/server/ai/outline";

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

export function skeletonData(type: string, intent: string, topic: string): Record<string, unknown> {
  if (type === "heading" || type === "subheading") return { text: topic }; // server knows the title
  if (isText(type)) return { text: "" }; // blank until patched
  return coerceSlot(type, {}, "", intent).data; // minimal VISUAL — non-empty by construction
}

/** All N skeleton blocks in slot order. `type` is the FINAL type: coerce may
 *  downgrade a visual it can't natively build (e.g. flow/map → mindmap), and that
 *  resolved type becomes the slot's locked type — the fill rungs target it and
 *  `patch` only ever updates `data`. */
export function buildSkeleton(outline: OutlineSlot[], topic: string): SkeletonBlock[] {
  return outline.map((s) => {
    if (s.type === "heading" || s.type === "subheading") return { type: s.type, data: { text: topic }, streamText: topic };
    if (isText(s.type)) return { type: s.type, data: { text: "" }, streamText: "" };
    const c = coerceSlot(s.type, {}, "", s.intent); // c.type may downgrade a hard visual
    return { type: c.type, data: c.data };
  });
}
