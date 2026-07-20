"use client";

import { useRef } from "react";
import { color, font } from "@/config/tokens";
import { Button } from "@/components/ui/button";
import { registerWorkspaceBlocks } from "@/features/workspace/blocks/manifest";
import { WorkspaceCanvas } from "@/features/workspace/renderer/WorkspaceCanvas";
import { Minimap } from "@/features/workspace/navigation/Minimap";
import { useViewport } from "@/features/workspace/viewport/useViewport";
import { useCameraNavigation } from "@/features/workspace/navigation/useCameraNavigation";
import { useWorkspaceKeyboard } from "@/features/workspace/interaction/useWorkspaceKeyboard";
import { useWorkspacePersistence } from "@/features/workspace/persistence/useWorkspacePersistence";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { seedExplanation, stressSeed } from "@/features/workspace/seed";

// Register the hosted block set once (client).
registerWorkspaceBlocks();

const WORKSPACE_ID = "default";

export function Workspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useViewport(containerRef);
  const regions = useWorkspaceStore((s) => s.doc.regions);
  const camera = useCameraStore((s) => s.camera);
  const reset = useWorkspaceStore((s) => s.reset);
  const nav = useCameraNavigation(size);

  useWorkspaceKeyboard(containerRef, { onFit: () => nav.fitAll(useWorkspaceStore.getState().doc.regions) });
  useWorkspacePersistence(WORKSPACE_ID);

  const addExplanation = () => {
    const region = seedExplanation(`Explanation ${regions.length + 1}`, regions.length);
    nav.goTo(region);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: color.bg, overflow: "hidden" }}>
      <WorkspaceCanvas containerRef={containerRef} size={size} />

      {/* verification harness — isolated /workspace route only */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          maxWidth: "72vw",
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: color.muted,
            marginRight: 4,
          }}
        >
          Workspace
        </span>
        <Button size="sm" variant="secondary" onClick={addExplanation}>
          New explanation
        </Button>
        <Button size="sm" variant="ghost" onClick={() => stressSeed()}>
          Stress test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => nav.fitAll(useWorkspaceStore.getState().doc.regions)}>
          Fit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            useCameraStore.getState().reset();
          }}
        >
          Clear
        </Button>
      </div>

      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          fontFamily: font.mono,
          fontSize: 11,
          color: color.muted,
        }}
      >
        {regions.length} regions · {Math.round(camera.scale * 100)}%
      </div>

      <Minimap regions={regions} camera={camera} viewport={size} onGoTo={nav.goTo} />
    </div>
  );
}
