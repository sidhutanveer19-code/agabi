"use client";

import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import { color, radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { ImageZoomData } from "./schema";

export function Renderer({ data }: BlockRendererProps<ImageZoomData>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const viewer = OpenSeadragon({
      element: ref.current,
      tileSources: { type: "image", url: data.src },
      showNavigationControl: false,
      showNavigator: false,
      gestureSettingsMouse: { clickToZoom: true },
    });
    return () => viewer.destroy();
  }, [data.src]);

  return (
    <div
      ref={ref}
      aria-label={data.alt ?? "Zoomable image"}
      style={{ width: "100%", height: 320, borderRadius: radius.lg, overflow: "hidden", background: color.paper }}
    />
  );
}
