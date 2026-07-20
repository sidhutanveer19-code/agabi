import type { Camera, WorkspaceDoc } from "@/features/workspace/types";

/**
 * The persistence seam. Everything the workspace needs to save and restore a
 * student's long-term environment, behind one interface.
 *
 * Today the only implementation is localStorage (frontend). A future backend
 * (Phase 3+) implements this same interface — the engine, stores, and autosave
 * hook never change. No database assumptions leak past this boundary.
 */
export interface WorkspacePersistence {
  saveDoc(workspaceId: string, doc: WorkspaceDoc): void | Promise<void>;
  loadDoc(workspaceId: string): WorkspaceDoc | null | Promise<WorkspaceDoc | null>;
  saveCamera(workspaceId: string, camera: Camera): void | Promise<void>;
  loadCamera(workspaceId: string): Camera | null | Promise<Camera | null>;
}
