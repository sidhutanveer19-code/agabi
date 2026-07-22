"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TeachRequest, TeachStatus } from "@/features/workspace/ai/types";
import { openRegion, addStreamedBlock, PAD } from "@/features/workspace/ai/streamRegion";
import { useTeachingContext } from "@/features/workspace/ai/context";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { teachingProvider } from "@/features/platform/providers";
import { eventBus } from "@/features/platform/events/eventBus";

/** The teaching provider — the real backend streaming service (platform/providers). */
const provider = teachingProvider;

export interface TeachingError {
  recoverable: boolean;
  message: string;
}

/**
 * Drives the AI teaching experience: consumes a provider stream and streams
 * blocks into the workspace (append-only), tracking status/errors and never
 * blocking the UI. `onFocusRegion` lets the caller fly the camera to a new
 * explanation (while respecting the student's own navigation).
 */
export function useTeaching(opts: { canvasId: string; onFocusRegion: (regionId: string) => void }) {
  const canvasIdRef = useRef(opts.canvasId);
  useEffect(() => { canvasIdRef.current = opts.canvasId; }, [opts.canvasId]);
  const [status, setStatus] = useState<TeachStatus>("idle");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<TeachingError | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const lastReqRef = useRef<TeachRequest | null>(null);
  const focusRef = useRef(opts.onFocusRegion);
  useEffect(() => {
    focusRef.current = opts.onFocusRegion;
  }, [opts.onFocusRegion]);

  const run = useCallback(async (req: TeachRequest) => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    lastReqRef.current = req;
    setError(null);
    setStreaming(true);

    // (Memory reset removed — the canvas is one continuous space; the AI keeps
    //  memory of everything on it. Server-side context comes from buildCanvasContext.)
    const ctx = useTeachingContext.getState();
    const context = { topic: ctx.topic, explanations: ctx.explanations, selectedRegionId: ctx.selectedRegionId };
    eventBus.emit(
      req.kind === "lesson" ? "lesson_started" : req.kind === "question" ? "question" : "command",
      { topic: req.topic, command: req.command, text: req.text }
    );

    let regionId: string | null = null;
    const blockIds: string[] = [];
    let cursor = PAD;

    try {
      for await (const ev of provider.teach(req, context, ac.signal, canvasIdRef.current)) {
        switch (ev.t) {
          case "status":
            setStatus(ev.status);
            break;
          case "region": {
            const { id } = openRegion(ev.title);
            regionId = id;
            blockIds.length = 0;
            cursor = PAD;
            useTeachingContext.getState().addExplanation({ regionId: id, title: ev.title, kind: req.kind });
            focusRef.current(id);
            break;
          }
          case "block":
            if (regionId) {
              const { blockId, nextCursor } = addStreamedBlock(regionId, ev.block, cursor);
              blockIds.push(blockId);
              cursor = nextCursor;
            }
            break;
          case "patch":
            if (regionId) {
              const bid = blockIds[ev.index];
              if (bid) useWorkspaceStore.getState().updateBlock(regionId, bid, { data: ev.data });
            }
            break;
          case "error":
            setError({ recoverable: ev.recoverable, message: ev.message });
            if (!ev.recoverable) { setStreaming(false); return; }
            break;
          case "done":
            eventBus.emit("lesson_completed", { topic: req.topic });
            break;
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setError({ recoverable: true, message: e instanceof Error ? e.message : "Something interrupted the lesson." });
      }
    } finally {
      if (acRef.current === ac) setStreaming(false);
    }
  }, []);

  const startLesson = useCallback((topic: string) => { void run({ kind: "lesson", topic }); }, [run]);
  const sendCommand = useCallback((command: string) => {
    void run({ kind: "command", topic: useTeachingContext.getState().topic, command });
  }, [run]);
  const ask = useCallback((text: string) => {
    void run({ kind: "question", topic: useTeachingContext.getState().topic, text });
  }, [run]);
  const cancel = useCallback(() => {
    acRef.current?.abort();
    setStreaming(false);
    setStatus("cancelled");
  }, []);
  const retry = useCallback(() => {
    if (lastReqRef.current) void run(lastReqRef.current);
  }, [run]);
  const dismissError = useCallback(() => setError(null), []);

  return { status, streaming, error, startLesson, sendCommand, ask, cancel, retry, dismissError };
}
