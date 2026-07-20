"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export interface MapMarker {
  lng: number;
  lat: number;
  label?: string;
}

export interface MapData {
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
}

const MAP_STYLE = "https://demotiles.maplibre.org/style.json";

/** MapLibre GL renderer (lazy-loaded). Pans/zooms in present, edits center/zoom in dev. */
export default function MapRenderer({ block, editing, onChange }: BlockRendererProps<MapData>) {
  const data: MapData = block.data ?? { center: [0, 20], zoom: 1, markers: [] };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const set = (p: Partial<MapData>) => onChange?.({ ...data, ...p });

  // Create the map once on mount; tear it down on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: data.center,
      zoom: data.zoom,
      attributionControl: false,
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only; center/zoom/markers are synced via effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync camera to data (present mode reflects saved view; edits jump the camera).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({ center: data.center, zoom: data.zoom });
  }, [data.center, data.zoom]);

  // Sync markers to data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = data.markers.map((mk) => {
      const marker = new maplibregl.Marker({ color: color.violet2 }).setLngLat([mk.lng, mk.lat]);
      if (mk.label) marker.setPopup(new maplibregl.Popup({ offset: 24 }).setText(mk.label));
      marker.addTo(map);
      return marker;
    });
  }, [data.markers]);

  const num = (v: string, fallback: number) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div
      role="figure"
      aria-label="Geographic map"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: space[2],
            left: space[2],
            display: "flex",
            flexWrap: "wrap",
            gap: space[2],
            padding: space[2],
            borderRadius: radius.md,
            background: color.surface,
            border: `1px solid ${color.border}`,
            backdropFilter: "blur(8px)",
            fontFamily: font.mono,
            fontSize: 11,
            color: color.muted,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            lng
            <input
              type="number"
              step="any"
              aria-label="Center longitude"
              value={data.center[0]}
              onChange={(e) => set({ center: [num(e.target.value, data.center[0]), data.center[1]] })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            lat
            <input
              type="number"
              step="any"
              aria-label="Center latitude"
              value={data.center[1]}
              onChange={(e) => set({ center: [data.center[0], num(e.target.value, data.center[1])] })}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            zoom
            <input
              type="number"
              step="any"
              min={0}
              max={22}
              aria-label="Zoom level"
              value={data.zoom}
              onChange={(e) => set({ zoom: num(e.target.value, data.zoom) })}
              style={inputStyle}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: 78,
  padding: "4px 6px",
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.paper,
  color: color.ink,
  fontFamily: font.mono,
  fontSize: 12,
  outline: "none",
};
