import type { Camera, WorkspaceDoc } from "@/features/workspace/types";

/** The persistence seam — swap localStorage for a backend without touching callers. */
export interface WorkspacePersistence {
  saveDoc: (doc: WorkspaceDoc) => void;
  loadDoc: (workspaceId: string) => WorkspaceDoc | null;
  saveCamera: (workspaceId: string, camera: Camera) => void;
  loadCamera: (workspaceId: string) => Camera | null;
}
