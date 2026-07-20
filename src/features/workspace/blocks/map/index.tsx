"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { MapPin } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MapData } from "@/features/workspace/blocks/map/Renderer";

// Heavy library — code-split, loaded only when a map block mounts.
const MapRenderer = dynamic(() => import("@/features/workspace/blocks/map/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="map…" />,
});

const schema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number(),
  markers: z.array(
    z.object({
      lng: z.number(),
      lat: z.number(),
      label: z.string().optional(),
    }),
  ),
}) as z.ZodType<MapData>;

function MapBlock(props: BlockRendererProps<MapData>) {
  return <MapRenderer {...props} />;
}

export function registerMapBlock(): void {
  if (hasBlock("map")) return;
  const def: BlockDefinition<MapData> = {
    type: "map",
    label: "Map",
    category: "media",
    icon: MapPin,
    version: 1,
    component: MapBlock,
    schema,
    create: () => ({
      center: [0, 20],
      zoom: 1,
      markers: [],
    }),
    defaultSize: { w: 480, h: 340 },
    interactive: true,
    resizable: true,
    keywords: ["map", "geography", "location", "maplibre", "marker", "atlas", "world"],
  };
  registerBlock(def);
}
