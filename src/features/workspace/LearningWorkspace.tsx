"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { color, font, radius, z as zTokens } from "@/config/tokens";
import { registerWorkspaceBlocks } from "@/features/workspace/blocks/manifest";
import { WorkspaceCanvas } from "@/features/workspace/renderer/WorkspaceCanvas";
import { useViewport } from "@/features/workspace/viewport/useViewport";
import { usePanZoom } from "@/features/workspace/interactions/usePanZoom";
import { useWorkspaceKeyboard } from "@/features/workspace/interactions/useWorkspaceKeyboard";
import { useCameraNavigation } from "@/features/workspace/navigation/useCameraNavigation";
import { useWorkspacePersistence } from "@/features/workspace/persistence/useWorkspacePersistence";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { useUiStore } from "@/features/workspace/stores/ui.store";
import { DEV_MODE } from "@/config/devMode";
import { BlockPalette } from "@/features/workspace/palette/BlockPalette";
import { pasteBlock } from "@/features/workspace/blocks/insertBlock";
import { blockClipboard } from "@/features/workspace/blocks/shared/clipboard";
import { useTeaching } from "@/features/workspace/ai/useTeaching";
import { useTeachingContext } from "@/features/workspace/ai/context";
import { TEACH_COMMANDS } from "@/features/workspace/ai/commands";
import { StatusPill, TeachingErrorCard } from "@/features/workspace/ai/TeachingChrome";
import { SessionProvider } from "@/features/platform/session/SessionProvider";
import { SessionBanner } from "@/features/platform/session/SessionBanner";
import { eventBus } from "@/features/platform/events/eventBus";

// Register the hosted block set once (client) before first render.
registerWorkspaceBlocks();

const WORKSPACE_ID = "default";

/**
 * The Learning Workspace — Agabi's single teaching surface. Entering a topic
 * makes the AI stream a lesson as educational blocks into the infinite canvas.
 * Every interrupt (Simpler / Another example / a typed question…) streams a NEW
 * explanation region beside the existing ones — append-only, nothing overwritten.
 * (The handwritten board is retired from this flow; it remains on disk as a
 * legacy block type.)
 */
export function LearningWorkspace({ goal, onExit }: { goal?: string; onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = useViewport(containerRef);
  const nav = useCameraNavigation(viewport);

  const regions = useWorkspaceStore((s) => s.doc.regions);
  const [ask, setAsk] = useState("");
  const topic = (goal ?? "").trim();

  // Fly to a new explanation — but never steal control while the student pans.
  const focusRegion = useCallback(
    (regionId: string) => {
      if (useUiStore.getState().interaction === "panning") return;
      const region = useWorkspaceStore.getState().doc.regions.find((r) => r.id === regionId);
      if (region) nav.goTo(region);
    },
    [nav]
  );

  const { status, streaming, error, startLesson, sendCommand, ask: askQuestion, cancel, retry, dismissError } =
    useTeaching({ onFocusRegion: focusRegion });

  // Start the lesson only for a FRESH session — this runs after the restore
  // attempt resolves (sync local OR async backend), so a saved session is never
  // re-taught over the top of itself.
  const onRestored = useCallback(
    (hadDoc: boolean) => {
      useTeachingContext.getState().setTopic(topic);
      if (hadDoc || !topic || useWorkspaceStore.getState().doc.regions.length > 0) return;
      eventBus.emit("topic_opened", { topic });
      startLesson(topic);
    },
    [topic, startLesson]
  );
  useWorkspacePersistence(WORKSPACE_ID, onRestored);

  usePanZoom(containerRef);
  useWorkspaceKeyboard(containerRef, {
    onFit: () => nav.fitAll(useWorkspaceStore.getState().doc.regions),
    onGoToRegion: (region) => nav.goTo(region),
    getRegions: () => useWorkspaceStore.getState().doc.regions,
  });

  // Dev authoring keyboard (never active in the student build).
  const vpRef = useRef(viewport);
  useEffect(() => { vpRef.current = viewport; }, [viewport]);
  useEffect(() => {
    if (!DEV_MODE) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const sel = useUiStore.getState().selectedIds[0];
      const findRegion = () => useWorkspaceStore.getState().doc.regions.find((r) => r.blocks.some((b) => b.id === sel));
      if (e.key === "Escape") { useUiStore.getState().clearSelection(); return; }
      if (typing || !sel) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && blockClipboard.has() && !typing) { e.preventDefault(); pasteBlock(vpRef.current); }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const r = findRegion();
        if (r) { useWorkspaceStore.getState().deleteBlock(r.id, sel); useUiStore.getState().clearSelection(); }
      } else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); const r = findRegion(); if (r) useWorkspaceStore.getState().duplicateBlock(r.id, sel); }
      else if (mod && e.key.toLowerCase() === "c") { const r = findRegion(); const b = r?.blocks.find((x) => x.id === sel); if (b) blockClipboard.copy(b); }
      else if (mod && e.key.toLowerCase() === "v" && blockClipboard.has()) { e.preventDefault(); pasteBlock(vpRef.current); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submitAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk("");
    askQuestion(q);
  };

  const hasContent = regions.length > 0 || streaming;

  return (
    <SessionProvider>
    <div style={{ position: "absolute", inset: 0, background: color.bg, overflow: "hidden" }}>
      <WorkspaceCanvas containerRef={containerRef} viewport={viewport} />
      <SessionBanner />

      {/* brand — top-left */}
      <div style={{ position: "absolute", top: 22, left: 26, display: "flex", alignItems: "center", gap: 10, zIndex: zTokens.chrome }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: "linear-gradient(150deg,#7C3AED,#A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff" }}>✦</div>
        <span style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: "0.28em", fontWeight: 600, color: color.inkSoft }}>AGABI</span>
      </div>

      {/* AI status — top-center */}
      <div style={{ position: "absolute", top: 18, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: zTokens.chrome, pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto" }}>
          <StatusPill status={status} streaming={streaming} onStop={cancel} />
        </div>
      </div>

      {/* leave — top-right */}
      <button type="button" onClick={onExit} style={{ position: "absolute", top: 20, right: 24, zIndex: zTokens.chrome, border: "none", background: "transparent", color: color.muted3, fontFamily: font.sans, fontSize: 13, cursor: "pointer", padding: "6px 8px" }}>
        ← Leave
      </button>

      {/* error — above the bar */}
      {error && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 96, display: "flex", justifyContent: "center", zIndex: zTokens.overlay }}>
          <TeachingErrorCard error={error} onRetry={retry} onDismiss={dismissError} />
        </div>
      )}

      {/* teaching bar — ask + interrupt commands (each spawns a new region) */}
      {hasContent && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, zIndex: zTokens.chrome }}>
          {/* quick command chips */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center", maxWidth: "70vw" }}>
            {TEACH_COMMANDS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => sendCommand(c.id)}
                style={{ padding: "6px 12px", borderRadius: radius.pill, border: `1px solid ${color.border}`, background: "rgba(10,12,17,0.7)", color: color.muted3, fontFamily: font.sans, fontSize: 12.5, cursor: "pointer", backdropFilter: "blur(6px)" }}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="teachpill">
            <div className="askwrap">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7f7a6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z" />
              </svg>
              <input
                aria-label="Ask, interrupt, or challenge anything"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitAsk(); } }}
                placeholder="Ask anything… a new explanation appears beside this one."
              />
            </div>
          </div>
        </div>
      )}

      {/* dev-only block insert palette — never in the student build */}
      {DEV_MODE && <BlockPalette viewport={viewport} />}
    </div>
    </SessionProvider>
  );
}
