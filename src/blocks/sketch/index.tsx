"use client";

import { z } from "zod";
import TeachingBoard from "@/components/TeachingBoard";
import type { Lesson, VariantKey } from "@/lib/lesson";
import { projectileLesson } from "@/data/lessons/projectile";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  lesson: z.custom<Lesson>((v) => !!v && typeof v === "object"),
  variant: z.string().default("normal"),
});
type Data = z.infer<typeof schema>;

/**
 * Wraps the hand-drawn self-drawing SVG board (the Claude-design teaching board)
 * as a canvas block. The board is entirely data-driven (see src/lib/lesson.ts),
 * so any subject's sketch renders here.
 */
function Renderer({ data }: BlockRendererProps<Data>) {
  const variant = (data.variant ?? "normal") as VariantKey;
  const slots = data.lesson.variants[variant] ?? data.lesson.variants.normal;
  return <TeachingBoard lesson={data.lesson} slots={slots} drawing paused={false} />;
}

export const sketchBlock = defineBlock<Data>({
  type: "sketch",
  label: "Sketch board",
  category: "spatial",
  defaultSize: { w: 980, h: 720 },
  schema,
  Renderer,
  sample: { lesson: projectileLesson, variant: "normal" },
});
