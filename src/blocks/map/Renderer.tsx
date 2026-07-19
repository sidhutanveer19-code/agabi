"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { MapData } from "./schema";

// Free demo tiles. Self-host a style/tiles for production + offline.
const STYLE = "https://demotiles.maplibre.org/style.json";

export function Renderer({ data }: BlockRendererProps<MapData>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: data.center,
      zoom: data.zoom,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    if (data.markerLabel) {
      new maplibregl.Marker({ color: "#a78bfa" })
        .setLngLat(data.center)
        .setPopup(new maplibregl.Popup({ closeButton: false }).setText(data.markerLabel))
        .addTo(map);
    }
    return () => map.remove();
  }, [data]);

  return (
    <div ref={ref} style={{ width: "100%", height: 320, borderRadius: radius.lg, overflow: "hidden" }} />
  );
}
