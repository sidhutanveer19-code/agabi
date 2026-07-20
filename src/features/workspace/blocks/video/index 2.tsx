"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Video as VideoIcon } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { VideoData } from "@/features/workspace/blocks/video/Renderer";

// Native <video> renderer — code-split, loaded only when a video block mounts.
const VideoRenderer = dynamic(() => import("@/features/workspace/blocks/video/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="video…" />,
});

const schema = z.object({
  src: z.string(),
  poster: z.string(),
  captionsSrc: z.string().optional(),
}) as z.ZodType<VideoData>;

function VideoBlock(props: BlockRendererProps<VideoData>) {
  return <VideoRenderer {...props} />;
}

export function registerVideoBlock(): void {
  if (hasBlock("video")) return;
  const def: BlockDefinition<VideoData> = {
    type: "video",
    label: "Video",
    category: "media",
    icon: VideoIcon,
    version: 1,
    component: VideoBlock,
    schema,
    create: () => ({ src: "", poster: "", captionsSrc: "" }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["video", "clip", "movie", "media", "mp4", "player"],
  };
  registerBlock(def);
}
