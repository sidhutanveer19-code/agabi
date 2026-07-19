import type { WorkspaceDoc } from "@/workspace/blocks";

export type Depth = "normal" | "simpler" | "deeper";

/**
 * The seam between the frontend and the (future) backend. UI depends on these
 * interfaces only — swapping the mock for a real API changes `getServices()`.
 */
export interface LessonService {
  /** Compose a full multi-block workspace for a topic at a given depth. */
  composeWorkspace(topic: string, depth?: Depth): Promise<WorkspaceDoc>;
}

export interface PersistenceService {
  save(doc: WorkspaceDoc): Promise<void>;
  load(id: string): Promise<WorkspaceDoc | null>;
}

export interface Services {
  lesson: LessonService;
  persistence: PersistenceService;
}
