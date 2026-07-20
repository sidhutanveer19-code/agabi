import type { Lesson, VariantKey } from "@/features/canvas/lib/lesson";
import type { Region } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";
import { LESSON_BLOCK } from "@/features/workspace/blocks/lesson";

const BOARD_W = 1160;
const PAD = 20;

/** Board pixel height from the lesson's viewBox aspect ratio. */
function boardHeight(lesson: Lesson): number {
  const parts = lesson.viewBox.split(/\s+/).map(Number);
  const vbW = parts[2] || 1240;
  const vbH = parts[3] || 720;
  return Math.round(BOARD_W * (vbH / vbW)) || 640;
}

/**
 * Append one explanation region containing a single `lesson` block. This is the
 * real content path: a composed Lesson is placed on the infinite canvas as a
 * teaching board. New regions never overlap or overwrite existing ones — so
 * "explain it differently" lands beside the previous explanation.
 */
export function createLessonRegion(lesson: Lesson, variant: VariantKey, title: string): Region {
  const store = useWorkspaceStore.getState();
  const bh = boardHeight(lesson);
  const size = { w: BOARD_W + PAD * 2, h: bh + PAD * 2 };
  const id = store.createRegion(title, {
    size,
    accent: "#a78bfa",
    blocks: [
      {
        type: LESSON_BLOCK,
        position: { x: PAD, y: PAD },
        size: { w: BOARD_W, h: bh },
        data: { lesson, variant },
      },
    ],
  });
  return useWorkspaceStore.getState().doc.regions.find((r) => r.id === id) as Region;
}
