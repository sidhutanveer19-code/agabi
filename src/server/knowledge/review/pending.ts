import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { Statement, Provenance, SourceChunk } from "@/server/knowledge/types";
import type { ValidationResult } from "@/server/knowledge/validators/types";
import type { QueueItem } from "@/server/knowledge/review/queue";
import { prioritise, type QueueWeights } from "@/server/knowledge/review/queue";
import { v3Grounding, v4QuoteLength, v5Originality } from "@/server/knowledge/validators/grounding";

/**
 * The review queue's missing half (A3). `queue.ts` orders `QueueItem`s; `batch.ts` renders a
 * screen; `review-cli.mjs` collects decisions. Nothing built the list from the store, so M3 —
 * "a human promotes proposals, first real throughput measurement" — could not be run at all.
 *
 * This is that step, and it is a pure composition of existing reads: `dumpAll` for the pending
 * statements (a bulk read, because a statement with no subject is unreachable by concept walk and
 * would silently never be reviewed), `provenanceFor` for the quote, `getSourceChunk` for the
 * passage the reviewer reads — which only resolves because ingest now persists chunks (A2).
 *
 * The grounding gates are RE-RUN here against the stored chunk rather than trusted from ingest
 * time: validator output is not persisted, and a reviewer must see the check that applies to the
 * text in front of them.
 */

export interface PendingProposal {
  targetKind: "Statement";
  targetId: string;
  statement: Statement;
  quote: string;
  chunkId: string;
  chunkText: string;
  sourceId: string;
  validation: ValidationResult[];
  dependentCount: number; // leverage — how many edges build on this statement's subject
  /** R1: a proposal we cannot fully render is still listed, with the reason it is degraded. */
  degraded?: string;
}

export interface PendingQueue {
  proposals: PendingProposal[]; // prioritised
  /** R1: pending statements that could NOT be turned into a reviewable proposal, and why. */
  unreviewable: { targetId: string; reason: string }[];
  totals: { pending: number; reviewable: number; unreviewable: number };
}

export interface PendingOptions {
  /** Trust level to review. Default MACHINE_PROPOSED — the ingest terminal state. */
  trustLevel?: string;
  weights?: QueueWeights;
  /** Observed demand per concept id (from the evidence log). Absent → 0, never guessed. */
  knowledgeMissCount?: (conceptId: string) => number;
  programWeight?: (conceptId: string) => number;
  limit?: number;
}

/** Re-run the gates a reviewer needs to see, against the STORED chunk. */
export function revalidate(statement: Statement, quote: string, chunkText: string): ValidationResult[] {
  const raw = { form: statement.form, kind: statement.kind, text: statement.text, quote, structure: statement.structure as Record<string, unknown> };
  return [v3Grounding(raw, chunkText), v4QuoteLength(raw), v5Originality(raw)];
}

export async function buildPendingQueue(store: KnowledgeStore, opts: PendingOptions = {}): Promise<PendingQueue> {
  const trustLevel = opts.trustLevel ?? "MACHINE_PROPOSED";
  const dump = await store.dumpAll();

  const pending = dump.statements.filter((s) => s.trustLevel === trustLevel);
  const provByStatement = new Map<string, Provenance[]>();
  for (const p of dump.provenance) {
    const list = provByStatement.get(p.statementId);
    if (list) list.push(p);
    else provByStatement.set(p.statementId, [p]);
  }
  const chunkById = new Map<string, SourceChunk>(dump.sourceChunks.map((c) => [c.id, c]));

  // Leverage: how many dependency edges point at a statement's subject concept.
  const dependents = new Map<string, number>();
  for (const e of dump.dependencyEdges) dependents.set(e.toId, (dependents.get(e.toId) ?? 0) + 1);

  const proposals: PendingProposal[] = [];
  const unreviewable: { targetId: string; reason: string }[] = [];

  for (const s of pending) {
    const prov = provByStatement.get(s.id) ?? [];
    if (prov.length === 0) {
      unreviewable.push({ targetId: s.id, reason: "no provenance row — nothing to show the reviewer and nothing to check the quote against" });
      continue;
    }
    const p = prov[0];
    const chunk = chunkById.get(p.chunkId);
    if (!chunk) {
      // Pre-A2 rows point at chunks that were never stored. Still listed — never hidden.
      unreviewable.push({ targetId: s.id, reason: `provenance points at chunk ${p.chunkId}, which is not in the store (ingested before source persistence, A2)` });
      continue;
    }
    proposals.push({
      targetKind: "Statement",
      targetId: s.id,
      statement: s,
      quote: p.quote,
      chunkId: chunk.id,
      chunkText: chunk.text,
      sourceId: p.sourceId,
      validation: revalidate(s, p.quote, chunk.text),
      dependentCount: s.subjectId ? (dependents.get(s.subjectId) ?? 0) : 0,
      ...(s.subjectId ? {} : { degraded: "statement has no subject concept — it is reviewable but reachable from no concept (A-5 backfill pending)" }),
    });
  }

  const items: QueueItem[] = proposals.map((pr) => ({
    targetKind: pr.targetKind,
    targetId: pr.targetId,
    dependentCount: pr.dependentCount,
    knowledgeMissCount: pr.statement.subjectId ? (opts.knowledgeMissCount?.(pr.statement.subjectId) ?? 0) : 0,
    programWeight: pr.statement.subjectId ? (opts.programWeight?.(pr.statement.subjectId) ?? 0) : 0,
    ageInQueue: 0,
  }));
  const order = new Map(prioritise(items, opts.weights).map((it, i) => [it.targetId, i]));
  proposals.sort((a, b) => (order.get(a.targetId) ?? 0) - (order.get(b.targetId) ?? 0));

  const limited = opts.limit ? proposals.slice(0, opts.limit) : proposals;
  return {
    proposals: limited,
    unreviewable,
    totals: { pending: pending.length, reviewable: proposals.length, unreviewable: unreviewable.length },
  };
}
