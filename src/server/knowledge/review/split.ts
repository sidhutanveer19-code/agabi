import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope, ReviewEvent } from "@/server/knowledge/types";
import { splitTombstone } from "@/server/knowledge/concept";
import { mintId } from "@/server/knowledge/ids";

/**
 * Split (§20.3) — the direction reality forces: a reviewer discovers one concept has meant two
 * things in different contexts (kinetic energy in Physics, energy generally in Biology). The
 * source is tombstoned with `splitInto[]`, so an old reference now resolves HONESTLY AMBIGUOUS
 * rather than wrongly. That is why every concept reference carries `contextId` — observations
 * are apportioned to the targets BY THE CONTEXT ON EACH OBSERVATION (the apportionment itself
 * runs in the observation store, M8; the tombstone + ambiguity land here). A tombstone
 * `AmbiguousSplit` is never auto-resolved.
 */
export async function splitConcept(
  store: KnowledgeStore,
  opts: { sourceId: string; targetIds: string[]; actorId: string; scope?: ReadScope },
  now: Date = new Date(),
): Promise<ReviewEvent> {
  if (!opts.actorId.trim()) throw new Error("split requires a human actorId");
  if (opts.targetIds.length < 2) throw new Error("split needs at least two targets");
  const scope = opts.scope ?? "PUBLIC";
  const source = await store.getConcept(opts.sourceId, scope);
  if (!source) throw new Error(`split: source ${opts.sourceId} not found`);

  const tombstone = splitTombstone(source, opts.targetIds);
  await store.putConcept(tombstone); // status SPLIT, splitInto = targets → resolution is AMBIGUOUS

  const event: ReviewEvent = {
    id: mintId(), targetKind: "Concept", targetId: opts.sourceId, decision: "SPLIT",
    fromTrust: null, toTrust: null, actorId: opts.actorId, before: { slug: source.slug },
    after: { splitInto: opts.targetIds }, reason: `split into ${opts.targetIds.join(", ")}`, batchId: null, createdAt: now,
  };
  await store.putReviewEvent(event);
  await store.clearClosures();
  return event;
}
