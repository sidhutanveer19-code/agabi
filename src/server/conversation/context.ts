import { getActiveLesson, getLessons, type LessonRow } from "@/server/conversation/lessonRepo";

/**
 * The single source of what any model is told about the canvas. Deterministic —
 * built from persisted state, never from a model. This is also the seam Memory /
 * Student Model plug into later (add sources here; callers unchanged).
 */
export interface CanvasContext {
  canvasId: string;
  currentLesson: LessonRow | null;
  focusedRegionId: string | null;
  previousLessons: { topic: string; regionId: string; state: string }[];
}

export async function buildCanvasContext(userId: string, canvasId: string): Promise<CanvasContext> {
  const [current, all] = await Promise.all([getActiveLesson(userId, canvasId), getLessons(userId, canvasId)]);
  return {
    canvasId,
    currentLesson: current,
    focusedRegionId: current?.regionId ?? null,
    previousLessons: all
      .filter((l) => l.id !== current?.id)
      .map((l) => ({ topic: l.topic, regionId: l.regionId, state: l.state })),
  };
}
