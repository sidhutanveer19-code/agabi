/**
 * Review queue ordering (§25.3). Review follows OBSERVED DEMAND, not curriculum order —
 * which is what makes the first ~200 concepts disproportionately valuable. Leverage
 * (errors that propagate) and real student demand (`knowledgeMissCount`, from the evidence
 * log) dominate; an age term guards against starvation so nothing waits forever.
 *
 *   priority = w1·dependentCount + w2·knowledgeMissCount + w3·programWeight − w4·ageInQueue
 *
 * Pure and deterministic (tie-break by target id) so the queue is reproducible.
 */
export interface QueueItem {
  targetKind: string;
  targetId: string;
  dependentCount: number; // leverage — how many things build on this
  knowledgeMissCount: number; // observed demand from the evidence log
  programWeight: number; // exam importance
  ageInQueue: number; // starvation guard (hours, say)
}

export interface QueueWeights {
  dependent: number;
  miss: number;
  program: number;
  age: number;
}

export const DEFAULT_WEIGHTS: QueueWeights = { dependent: 3, miss: 2, program: 1, age: 0.1 };

export function priority(item: QueueItem, w: QueueWeights = DEFAULT_WEIGHTS): number {
  return (
    w.dependent * item.dependentCount +
    w.miss * item.knowledgeMissCount +
    w.program * item.programWeight -
    w.age * item.ageInQueue
  );
}

/** Highest priority first; ties broken by target id so the order is deterministic. */
export function prioritise(items: QueueItem[], w: QueueWeights = DEFAULT_WEIGHTS): QueueItem[] {
  return [...items].sort((a, b) => {
    const d = priority(b, w) - priority(a, w);
    if (d !== 0) return d;
    return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  });
}
