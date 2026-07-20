import type { Camera, WorkspaceDoc } from "@/features/workspace/types";
import { serialize, deserialize } from "@/features/workspace/serialization/serialize";
import { cameraSchema } from "@/features/workspace/serialization/schema";
import type { WorkspacePersistence } from "./PersistenceService";

const docKey = (id: string) => `agabi:ws:doc:${id}`;
const camKey = (id: string) => `agabi:ws:cam:${id}`;

/** localStorage-backed persistence. Corrupt/absent data returns null (recover). */
export const localWorkspacePersistence: WorkspacePersistence = {
  saveDoc(doc: WorkspaceDoc) {
    try {
      window.localStorage.setItem(docKey(doc.id), serialize(doc));
    } catch {
      /* storage unavailable */
    }
  },
  loadDoc(workspaceId: string) {
    try {
      const raw = window.localStorage.getItem(docKey(workspaceId));
      return raw ? deserialize(raw) : null;
    } catch {
      return null;
    }
  },
  saveCamera(workspaceId: string, camera: Camera) {
    try {
      window.localStorage.setItem(camKey(workspaceId), JSON.stringify(camera));
    } catch {
      /* storage unavailable */
    }
  },
  loadCamera(workspaceId: string) {
    try {
      const raw = window.localStorage.getItem(camKey(workspaceId));
      if (!raw) return null;
      const parsed = cameraSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
};
