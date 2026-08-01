import type { ObservationStore } from "@/server/observation/store";
import type { ReinforcementEdge } from "@/server/knowledge/types";

/**
 * Earned reinforcement edges (§11.2). If mastering X measurably improves later performance on
 * Y, that is an edge with EVIDENCE — `earned: true` distinguishes it from an authored one. This
 * DERIVES candidate edges from observation patterns and returns them; it does NOT write the
 * knowledge graph (W4 — observation never touches the knowledge store). A separate, knowledge-
 * side process reviews and writes them, so a measured edge still goes through the trust ladder.
 *
 * Phase-2 heuristic (deliberately simple, documented as such): within a learner's timeline, a
 * success on X followed by a success on a distinct Y is a signal X→Y; an edge is proposed when
 * enough DISTINCT learners show the pattern. No causal claim beyond "worth a reviewer's look".
 */
export async function earnedEdges(store: ObservationStore, minLearners = 2): Promise<ReinforcementEdge[]> {
  const learners = new Set((await store.all()).map((o) => o.learnerId));
  const pairLearners = new Map<string, Set<string>>(); // "X\tY" → set of learners exhibiting it

  for (const learnerId of learners) {
    const timeline = (await store.byLearner(learnerId))
      .filter((o) => o.outcome.success)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    // consecutive successes on distinct concepts → an X→Y signal
    for (let i = 0; i + 1 < timeline.length; i++) {
      for (const x of timeline[i].conceptIds) {
        for (const y of timeline[i + 1].conceptIds) {
          if (x === y) continue;
          const key = `${x}\t${y}`;
          (pairLearners.get(key) ?? pairLearners.set(key, new Set()).get(key)!).add(learnerId);
        }
      }
    }
  }

  const edges: ReinforcementEdge[] = [];
  for (const [key, set] of pairLearners) {
    if (set.size < minLearners) continue;
    const [fromId, toId] = key.split("\t");
    edges.push({ fromId, toId, type: "REINFORCES", strength: set.size, earned: true, contextId: null, version: 1 });
  }
  return edges.sort((a, b) => (a.fromId + a.toId < b.fromId + b.toId ? -1 : 1));
}
