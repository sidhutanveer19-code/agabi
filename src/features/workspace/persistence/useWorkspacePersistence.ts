"use client";

import { useEffect } from "react";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { debounce } from "@/features/workspace/utils/debounce";
import { localWorkspacePersistence } from "./localStorage";

/**
 * Session restoration + debounced autosave. On mount, restores the exact
 * workspace document and camera position. Thereafter, doc + camera changes are
 * saved (debounced). Restoration uses external store actions (not React state),
 * so it is safe inside the mount effect.
 */
export function useWorkspacePersistence(workspaceId: string): void {
  // restore once
  useEffect(() => {
    const doc = localWorkspacePersistence.loadDoc(workspaceId);
    if (doc) useWorkspaceStore.getState().setDoc(doc);
    const camera = localWorkspacePersistence.loadCamera(workspaceId);
    if (camera) useCameraStore.getState().setCamera(camera);
  }, [workspaceId]);

  // autosave document
  useEffect(() => {
    const save = debounce(() => localWorkspacePersistence.saveDoc(useWorkspaceStore.getState().doc), 400);
    const unsub = useWorkspaceStore.subscribe(save);
    return () => {
      save.flush();
      unsub();
    };
  }, [workspaceId]);

  // autosave camera
  useEffect(() => {
    const save = debounce(
      () => localWorkspacePersistence.saveCamera(workspaceId, useCameraStore.getState().camera),
      300
    );
    const unsub = useCameraStore.subscribe(save);
    return () => {
      save.flush();
      unsub();
    };
  }, [workspaceId]);
}
