"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Images } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { GalleryData } from "@/features/workspace/blocks/gallery/Renderer";

// Heavy renderer — code-split, loaded only when a gallery block mounts.
const GalleryRenderer = dynamic(() => import("@/features/workspace/blocks/gallery/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="gallery…" />,
});

const schema = z.object({
  images: z.array(z.object({ src: z.string(), caption: z.string().optional() })),
}) as z.ZodType<GalleryData>;

function GalleryBlock(props: BlockRendererProps<GalleryData>) {
  return <GalleryRenderer {...props} />;
}

export function registerGalleryBlock(): void {
  if (hasBlock("gallery")) return;
  const def: BlockDefinition<GalleryData> = {
    type: "gallery",
    label: "Gallery",
    category: "media",
    icon: Images,
    version: 1,
    component: GalleryBlock,
    schema,
    create: () => ({ images: [] }),
    defaultSize: { w: 460, h: 360 },
    interactive: true,
    resizable: true,
    keywords: ["gallery", "images", "photos", "grid", "lightbox", "media"],
  };
  registerBlock(def);
}
