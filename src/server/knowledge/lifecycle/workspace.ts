import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope, TrustPolicy } from "@/server/knowledge/types";
import { LIFECYCLE_STATES, type LifecycleState, lifecycleOf } from "@/server/knowledge/lifecycle/lifecycle";

/**
 * The Knowledge Authoring Workspace query surface (W8). Derived, never stored: it groups knowledge
 * objects by their current lifecycle state — the per-state work queues a reviewer/author operates
 * against, and the input to the review + coverage dashboards. A pure read; no state is materialised.
 */
export type WorkspaceByState = Record<LifecycleState, string[]>;

function empty(): WorkspaceByState {
  return Object.fromEntries(LIFECYCLE_STATES.map((s) => [s, [] as string[]])) as WorkspaceByState;
}

/** Group every subject-statement (deduped) by its derived lifecycle state. Deterministic (sorted). */
export async function listByState(store: KnowledgeStore, scope: ReadScope, policy: TrustPolicy): Promise<WorkspaceByState> {
  const out = empty();
  const seen = new Set<string>();
  for (const c of await store.listConcepts(scope)) {
    for (const s of await store.statementsForSubject(c.id, scope, policy)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const events = await store.reviewEventsFor("Statement", s.id);
      const state = lifecycleOf({ trustLevel: s.trustLevel, superseded: false, decisions: events.map((e) => e.decision) });
      out[state].push(s.id);
    }
  }
  for (const k of LIFECYCLE_STATES) out[k].sort();
  return out;
}

/** Count of objects in each lifecycle state — the dashboard summary. */
export async function stateCounts(store: KnowledgeStore, scope: ReadScope, policy: TrustPolicy): Promise<Record<LifecycleState, number>> {
  const grouped = await listByState(store, scope, policy);
  return Object.fromEntries(LIFECYCLE_STATES.map((s) => [s, grouped[s].length])) as Record<LifecycleState, number>;
}
