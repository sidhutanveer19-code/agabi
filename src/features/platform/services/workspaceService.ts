import { ENDPOINTS, workspaceStateSchema } from "@contract";
import type { WorkspacePersistence } from "@/features/workspace/persistence/PersistenceService";
import type { Camera, WorkspaceDoc } from "@/features/workspace/types";
import { apiClient } from "@/features/platform/client/apiClient";

/**
 * Backend workspace persistence — implements the same `WorkspacePersistence`
 * interface as the localStorage impl, so the autosave/restore hook is unchanged.
 * The backend stores doc + camera together; this caches the combined state and
 * PUTs it on either save, and fetches once per id (deduped) on load.
 */
type Slot = { doc: WorkspaceDoc | null; camera: Camera | null };
const cache = new Map<string, Slot>();
const inflight = new Map<string, Promise<void>>();

function slot(id: string): Slot {
  let s = cache.get(id);
  if (!s) { s = { doc: null, camera: null }; cache.set(id, s); }
  return s;
}

async function fetchState(id: string): Promise<void> {
  try {
    const raw = await apiClient.getJson<unknown>(ENDPOINTS.workspace(id).get.path);
    const parsed = workspaceStateSchema.safeParse(raw);
    if (parsed.success) {
      const s = slot(id);
      s.doc = parsed.data.doc as WorkspaceDoc;
      s.camera = parsed.data.camera as Camera;
    }
  } catch {
    /* new/empty workspace (404) or backend down → keep nulls, caller recovers */
  }
}

function ensureFetched(id: string): Promise<void> {
  let p = inflight.get(id);
  if (!p) {
    p = fetchState(id).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

async function put(id: string): Promise<void> {
  const s = slot(id);
  if (!s.doc) return;
  await apiClient.putJson(ENDPOINTS.workspace(id).put.path, {
    doc: s.doc,
    camera: s.camera ?? { x: 0, y: 0, scale: 1 },
  });
}

export const workspaceService: WorkspacePersistence = {
  async loadDoc(id) {
    await ensureFetched(id);
    return slot(id).doc;
  },
  async loadCamera(id) {
    await ensureFetched(id);
    return slot(id).camera;
  },
  async saveDoc(id, doc) {
    slot(id).doc = doc;
    await put(id);
  },
  async saveCamera(id, camera) {
    slot(id).camera = camera;
    await put(id);
  },
};
