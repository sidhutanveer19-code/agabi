"use client";

import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import type { Lesson, VariantKey } from "@/features/canvas/lib/lesson";
import TeachingBoard from "@/features/canvas/TeachingBoard";

/**
 * The `lesson` block — the first REAL content block. It hosts the approved
 * handwritten teaching board (the faithful design port) inside a workspace
 * region, so a composed lesson renders directly on the infinite canvas.
 *
 * The board is domain-agnostic: it draws whatever `Lesson` data it is given.
 * A future AI teaching engine streams `Lesson`s into these blocks; today they
 * are composed from the topic on entry.
 */
export interface LessonBlockData {
  lesson: Lesson;
  variant: VariantKey;
}

function LessonBlock({ block }: BlockRendererProps<LessonBlockData>) {
  const { lesson, variant } = block.data;
  const slots = lesson.variants[variant];
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* drawing=true triggers the hand-drawn reveal; strokes stay visible after
          (the CSS animation is forwards-filled) and re-draw if panned back in. */}
      <TeachingBoard lesson={lesson} slots={slots} drawing paused={false} />
    </div>
  );
}

export const LESSON_BLOCK = "lesson";

export const lessonBlockDefinition: BlockDefinition<LessonBlockData> = {
  type: LESSON_BLOCK,
  label: "Lesson",
  component: LessonBlock,
};
