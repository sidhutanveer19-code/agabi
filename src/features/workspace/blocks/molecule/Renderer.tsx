"use client";

import { useEffect, useRef } from "react";
import * as $3Dmol from "3dmol";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export type MoleculeFormat = "pdb" | "sdf" | "xyz" | "mol";

export interface MoleculeData {
  format: MoleculeFormat;
  data: string;
}

const FORMATS: readonly MoleculeFormat[] = ["pdb", "sdf", "xyz", "mol"] as const;

/**
 * 3Dmol.js molecule viewer (lazy-loaded so the WebGL lib is code-split).
 * Renders an interactive ball-and-stick model in present mode; adds a paste
 * panel (format + data) in dev editing mode. All state lives in `block.data`.
 */
export default function MoleculeRenderer({ block, editing, onChange }: BlockRendererProps<MoleculeData>) {
  const data: MoleculeData = block.data ?? { format: "xyz", data: "" };
  const set = (p: Partial<MoleculeData>) => onChange?.({ ...data, ...p });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const molData = data.data.trim();

  useEffect(() => {
    const el = hostRef.current;
    if (!el || molData === "") return;

    let viewer: ReturnType<typeof $3Dmol.createViewer> | undefined;
    try {
      viewer = $3Dmol.createViewer(el, { backgroundColor: color.paper });
      viewer.addModel(data.data, data.format);
      viewer.setStyle({}, { stick: {}, sphere: { scale: 0.3 } });
      viewer.zoomTo();
      viewer.render();
    } catch {
      // Malformed molecule data — leave the host empty rather than crash.
    }

    return () => {
      try {
        viewer?.clear();
      } catch {
        // ignore teardown errors
      }
      // 3Dmol appends its own canvas; scrub the host so re-mounts don't stack.
      if (el) el.replaceChildren();
    };
  }, [data.data, data.format, molData]);

  return (
    <div
      role="img"
      aria-label="3D molecule viewer"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: space[2],
            padding: space[3],
            borderBottom: `1px solid ${color.border}`,
            background: color.surface,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: space[2] }}>
            <label
              htmlFor={`mol-format-${block.id}`}
              style={{ fontFamily: font.mono, fontSize: 11, color: color.muted }}
            >
              format
            </label>
            <select
              id={`mol-format-${block.id}`}
              value={data.format}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => set({ format: e.target.value as MoleculeFormat })}
              style={{
                fontFamily: font.mono,
                fontSize: 12,
                color: color.ink,
                background: color.paper,
                border: `1px solid ${color.border}`,
                borderRadius: radius.sm,
                padding: `${space[1]}px ${space[2]}px`,
              }}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: color.muted2 }}>
              paste pdb / sdf / xyz / mol data below
            </span>
          </div>
          <textarea
            value={data.data}
            spellCheck={false}
            placeholder="Paste molecule data…"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => set({ data: e.target.value })}
            style={{
              width: "100%",
              minHeight: 92,
              resize: "vertical",
              fontFamily: font.mono,
              fontSize: 12,
              lineHeight: 1.5,
              color: color.inkSoft,
              background: color.paper,
              border: `1px solid ${color.border}`,
              borderRadius: radius.sm,
              padding: space[2],
              outline: "none",
            }}
          />
        </div>
      ) : null}

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {molData === "" ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: space[4],
              textAlign: "center",
              fontFamily: font.mono,
              fontSize: 12,
              color: color.muted,
            }}
          >
            Paste molecule data{editing ? " above" : ""} to view the 3D structure.
          </div>
        ) : (
          <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%" }} />
        )}
      </div>
    </div>
  );
}
