"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { AudioLines } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { AudioData } from "@/features/workspace/blocks/audio/Renderer";

// Heavy renderer — code-split, loaded only when an audio block mounts.
const AudioRenderer = dynamic(() => import("@/features/workspace/blocks/audio/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="audio…" />,
});

const schema = z.object({ src: z.string(), title: z.string() }) as z.ZodType<AudioData>;

function AudioBlock(props: BlockRendererProps<AudioData>) {
  return <AudioRenderer {...props} />;
}

export function registerAudioBlock(): void {
  if (hasBlock("audio")) return;
  const def: BlockDefinition<AudioData> = {
    type: "audio",
    label: "Audio",
    category: "media",
    icon: AudioLines,
    version: 1,
    component: AudioBlock,
    schema,
    create: () => ({ src: "", title: "" }),
    defaultSize: { w: 360, h: 140 },
    interactive: true,
    resizable: true,
    keywords: ["audio", "sound", "music", "player", "podcast", "mp3", "track"],
  };
  registerBlock(def);
}
