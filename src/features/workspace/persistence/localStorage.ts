import type { Camera, WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";
import type { WorkspacePersistence } from "@/features/workspace/persistence/PersistenceService";
import { serialize, deserialize } from "@/features/workspace/serialization/serialize";
import { cameraSchema } from "@/features/workspace/serialization/schema";

/**
 * Frontend persistence backed by localStorage.
 *
 * Storage keys are namespaced by SCHEMA_VERSION, so data written under an
 * incompatible schema is simply never read (a future version bump orphans old
 * data instead of loading it). This is what prevents a stale document from an
 * earlier build resurfacing with blocks the current registry no longer knows.
 *
 * Reads are defensive: corrupt/absent/incompatible data returns `null` and the
 * caller recovers to a fresh workspace. Writes are best-effort.
 */
const NS = `agabi:ws:s${SCHEMA_VERSION}`;
const docKey = (id: string) => `${NS}:doc:${id}`;
const camKey = (id: string) => `${NS}:cam:${id}`;

/** Unversioned keys from pre-versioning builds — purged so they can never load. */
const LEGACY_PREFIXES = ["agabi:ws:doc:", "agabi:ws:cam:"];

function purgeLegacy(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && LEGACY_PREFIXES.some((p) => k.startsWith(p))) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export const localWorkspacePersistence: WorkspacePersistence = {
  saveDoc(workspaceId, doc) {
    try {
      window.localStorage.setItem(docKey(workspaceId), serialize(doc));
    } catch {
      /* storage unavailable — non-fatal */
    }
  },

  loadDoc(workspaceId): WorkspaceDoc | null {
    purgeLegacy();
    try {
      const raw = window.localStorage.getItem(docKey(workspaceId));
      return raw ? deserialize(raw) : null;
    } catch {
      return null;
    }
  },

  saveCamera(workspaceId, camera) {
    try {
      window.localStorage.setItem(camKey(workspaceId), JSON.stringify(camera));
    } catch {
      /* non-fatal */
    }
  },

  loadCamera(workspaceId): Camera | null {
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
