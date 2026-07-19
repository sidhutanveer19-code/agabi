import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { imageZoomSample, imageZoomSchema, type ImageZoomData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={320} />,
});

export const imageZoomBlock = defineBlock<ImageZoomData>({
  type: "image-zoom",
  label: "Zoomable image",
  category: "media",
  defaultSize: { w: 560, h: 340 },
  schema: imageZoomSchema,
  Renderer,
  sample: imageZoomSample,
});
