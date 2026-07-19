import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { mapSample, mapSchema, type MapData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={320} />,
});

export const mapBlock = defineBlock<MapData>({
  type: "map",
  label: "Map",
  category: "rich",
  defaultSize: { w: 560, h: 340 },
  schema: mapSchema,
  Renderer,
  sample: mapSample,
});
