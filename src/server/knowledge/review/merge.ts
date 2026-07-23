import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope, ReviewEvent } from "@/server/knowledge/types";
import { mergeTombstone } from "@/server/knowledge/concept";
import { mintId } from "@/server/knowledge/ids";
import { assertHumanActor } from "@/server/knowledge/review/actor";

/**
 * Merge (§20.3, ADR-10). NEVER automatic — a wrong merge is worse than a duplicate and it is
 * silent, so a human decides every one (similarity only QUEUES a candidate). The merge is
 * NON-DESTRUCTIVE: the loser is tombstoned with `mergedInto` and its slug is kept as a
 * FORMER_NAME alias, so the loser's id resolves to the winner FOREVER — which is exactly what
 * makes reviewers willing to merge. A review event records the decision; closures are cleared
 * (§18) because the graph changed.
 */
export async function mergeConcepts(
  store: KnowledgeStore,
  opts: { loserId: string; winnerId: string; actorId: string; scope?: ReadScope },
  now: Date = new Date(),
): Promise<ReviewEvent> {
  assertHumanActor(opts.actorId, "merge (ADR-10)"); // same guard as every human-floor crossing
  const scope = opts.scope ?? "PUBLIC";
  const loser = await store.getConcept(opts.loserId, scope);
  if (!loser) throw new Error(`merge: loser ${opts.loserId} not found`);
  const winner = await store.getConcept(opts.winnerId, scope);
  if (!winner) throw new Error(`merge: winner ${opts.winnerId} not found`);

  const { concept, alias } = mergeTombstone(loser, opts.winnerId);
  await store.putConcept(concept); // overwrite loser row with its tombstone (status MERGED, mergedInto)
  await store.putConceptAlias(alias); // loser slug → winner, forever

  const event: ReviewEvent = {
    id: mintId(), targetKind: "Concept", targetId: opts.loserId, decision: "MERGE",
    fromTrust: null, toTrust: null, actorId: opts.actorId, before: { slug: loser.slug },
    after: { mergedInto: opts.winnerId }, reason: `merged into ${opts.winnerId}`, batchId: null, createdAt: now,
  };
  await store.putReviewEvent(event);
  await store.clearClosures(); // graph changed
  return event;
}
