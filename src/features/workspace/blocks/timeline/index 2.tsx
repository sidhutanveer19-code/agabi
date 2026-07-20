"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { CalendarClock } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { TimelineData } from "@/features/workspace/blocks/timeline/Renderer";

// Heavy library (vis-timeline) — code-split, loaded only when a timeline block mounts.
const TimelineRenderer = dynamic(() => import("@/features/workspace/blocks/timeline/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="timeline…" />,
});

const schema = z.object({
  items: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      content: z.string(),
      start: z.string(),
    }),
  ),
}) as z.ZodType<TimelineData>;

function TimelineBlock(props: BlockRendererProps<TimelineData>) {
  return <TimelineRenderer {...props} />;
}

export function registerTimelineBlock(): void {
  if (hasBlock("timeline")) return;
  const def: BlockDefinition<TimelineData> = {
    type: "timeline",
    label: "Timeline",
    category: "media",
    icon: CalendarClock,
    version: 1,
    component: TimelineBlock,
    schema,
    create: () => ({
      items: [
        { id: 1, content: "Printing press", start: "1440-01-01" },
        { id: 2, content: "Declaration of Independence", start: "1776-07-04" },
        { id: 3, content: "Moon landing", start: "1969-07-20" },
      ],
    }),
    defaultSize: { w: 560, h: 320 },
    interactive: true,
    resizable: true,
    keywords: ["timeline", "events", "history", "chronology", "dates", "vis"],
  };
  registerBlock(def);
}
