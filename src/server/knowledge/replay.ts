import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import { resolveAt } from "@/server/knowledge/version";

/**
 * Point-in-time replay (§19). A lesson records the release it was taught under; every
 * statement and asset it used is pinned by that release to an exact version. So a 2029 replay
 * of a 2026 lesson resolves each entity to the version the learner ACTUALLY saw — not whatever
 * is current. This is only possible because nothing is overwritten (append-only, ADR-5) and
 * releases pin version ids (§19).
 */
export interface LessonReplayInput {
  releaseId: string;
  statementIds: string[];
  assetIds: string[];
}

export interface ResolvedRef {
  requested: string;
  pinned: string | null; // the exact id the release pinned, or null if not in the release
}

export interface LessonReplay {
  releaseId: string;
  statements: ResolvedRef[];
  assets: ResolvedRef[];
  complete: boolean; // every referenced entity was pinned by the release
}

export async function replayLesson(store: KnowledgeStore, input: LessonReplayInput): Promise<LessonReplay> {
  const members = await store.releaseMembersOf(input.releaseId);
  const resolve = (kind: string, id: string): ResolvedRef => ({ requested: id, pinned: resolveAt(members, input.releaseId, kind, id) });

  const statements = input.statementIds.map((id) => resolve("Statement", id));
  const assets = input.assetIds.map((id) => resolve("TeachingAsset", id));
  const complete = [...statements, ...assets].every((r) => r.pinned !== null);
  return { releaseId: input.releaseId, statements, assets, complete };
}
