"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { workspacePersistence } from "@/features/platform/providers";
import { debounce } from "@/features/workspace/utils/debounce";

/**
 * Wire the workspace + camera to persistence:
 *  - on mount, restore the exact document and camera (session restoration)
 *  - thereafter, autosave both on change (debounced so rapid pans collapse)
 *
 * `onLoad(hadDoc)` fires once after the restore attempt so the caller can seed a
 * first explanation when there is nothing saved yet.
 */
export function useWorkspacePersistence(workspaceId: string, onLoad?: (hadDoc: boolean) => void) {
  useEffect(() => {
    let active = true;
    const p = workspacePersistence;

    const saveDoc = debounce(() => p.saveDoc(workspaceId, useWorkspaceStore.getState().doc), 400);
    const saveCam = debounce(() => p.saveCamera(workspaceId, useCameraStore.getState().camera), 300);

    // ---- clear the singleton stores FIRST (switching canvases) ----
    // The workspace/camera stores are global singletons holding one doc. Without this,
    // switching to a canvas that has no saved doc yet would show the PREVIOUS canvas's
    // blocks. Reset to empty, then the restore below re-applies this canvas's saved doc.
    useWorkspaceStore.getState().reset();
    useCameraStore.getState().reset();

    // ---- restore, then subscribe (restoring first avoids clobbering saved data) ----
    void Promise.all([
      Promise.resolve(p.loadDoc(workspaceId)),
      Promise.resolve(p.loadCamera(workspaceId)),
    ]).then(([doc, camera]) => {
      if (!active) return;
      if (doc) useWorkspaceStore.getState().setDoc(doc);
      if (camera) useCameraStore.getState().setCamera(camera);
      onLoad?.(Boolean(doc));
    });

    const unsubDoc = useWorkspaceStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc) saveDoc();
    });
    const unsubCam = useCameraStore.subscribe((s, prev) => {
      if (s.camera !== prev.camera) saveCam();
    });

    return () => {
      active = false;
      unsubDoc();
      unsubCam();
      saveDoc.flush();
      saveCam.flush();
    };
    // Restore/subscribe once per workspace id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
