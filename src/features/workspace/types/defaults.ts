import type { Camera, WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * Pure, framework-free builders for an empty workspace document and the initial
 * camera. Deliberately has NO "use client" and imports no React/zustand — so BOTH
 * the client stores AND server code (e.g. canvasRepo seeding a Workspace row) can
 * share the SAME definition, and the doc/camera shape can never drift between them.
 *
 * `emptyDoc()` output is guaranteed to pass `workspaceDocSchema` and `DEFAULT_CAMERA`
 * to pass `cameraSchema` (both in serialization/schema.ts) — asserted in a test.
 */

let docSeq = 0;

export function emptyDoc(topic?: string): WorkspaceDoc {
  docSeq += 1;
  const now = docSeq; // deterministic stamp; real time is applied on persist
  return {
    id: `ws_${docSeq}`,
    schemaVersion: SCHEMA_VERSION,
    topic,
    regions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** The initial/reset camera. Single source of truth (camera.store re-exports it). */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 };
