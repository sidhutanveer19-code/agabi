"use client";

import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { color, font, radius, elevation } from "@/config/tokens";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";

/** One positioned annotation. x/y are 0..1 fractions of the image box. */
export interface FigureLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

/** Serialized block state — everything lives here (validated by the zod schema in index.tsx). */
export interface FigureData {
  src: string;
  alt: string;
  labels: FigureLabel[];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Labeled Figure — an SVG-free overlay of positioned label pills on a responsive
 * image (biology/anatomy/etc, subject-agnostic). Present-only by default; in dev
 * `editing` mode you can set the src/alt, click the image to drop a label, and
 * drag pills to reposition. Coordinates are stored as 0..1 fractions so labels
 * track the image at any size.
 */
export default function FigureRenderer({ block, editing, onChange }: BlockRendererProps<FigureData>) {
  const data: FigureData = block.data ?? { src: "", alt: "", labels: [] };
  const stageRef = useRef<HTMLDivElement | null>(null);
  const draggingId = useRef<string | null>(null);
  const moved = useRef(false);
  const [broken, setBroken] = useState(false);
  // Untrusted (possibly AI-streamed) URL — scheme-guard the image sink (Law 23 + PROJECT).
  const imgSrc = safeUrl(data.src, "image");

  const commit = (patch: Partial<FigureData>): void => onChange?.({ ...data, ...patch });

  const fractionFrom = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = stageRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };

  const onStageClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editing) return;
    // Ignore the click that ends a drag.
    if (moved.current) {
      moved.current = false;
      return;
    }
    const f = fractionFrom(e.clientX, e.clientY);
    if (!f) return;
    const text = window.prompt("Label text");
    if (!text || !text.trim()) return;
    commit({ labels: [...data.labels, { id: newId(), x: f.x, y: f.y, text: text.trim() }] });
  };

  const startDrag = (id: string) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    draggingId.current = id;
    moved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPillMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!editing || draggingId.current === null) return;
    const f = fractionFrom(e.clientX, e.clientY);
    if (!f) return;
    moved.current = true;
    commit({ labels: data.labels.map((l) => (l.id === draggingId.current ? { ...l, x: f.x, y: f.y } : l)) });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (draggingId.current === null) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    draggingId.current = null;
  };

  const removeLabel = (id: string) => (e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    commit({ labels: data.labels.filter((l) => l.id !== id) });
  };

  const hasImage = !!imgSrc && !broken;

  return (
    <figure
      role="group"
      aria-label={data.alt ? `Labeled figure: ${data.alt}` : "Labeled figure"}
      style={{ width: "100%", height: "100%", margin: 0, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}
    >
      <div
        ref={stageRef}
        onClick={onStageClick}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 60,
          borderRadius: radius.md,
          background: color.surface,
          border: `1px solid ${color.border}`,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: editing && hasImage ? "crosshair" : "default",
        }}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote/data URLs on an infinite canvas; next/image needs known domains
          <img
            src={imgSrc ?? ""}
            alt={data.alt}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", pointerEvents: "none", userSelect: "none" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: color.muted, fontFamily: font.mono, fontSize: 11, padding: 12, textAlign: "center" }}>
            {broken ? "image failed to load" : "no image"}
            {editing ? <span style={{ color: color.muted2 }}>add an image URL below</span> : null}
          </div>
        )}

        {/* Positioned label overlay */}
        {data.labels.map((l) => (
          <div
            key={l.id}
            onPointerDown={startDrag(l.id)}
            onPointerMove={onPillMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: `${clamp01(l.x) * 100}%`,
              top: `${clamp01(l.y) * 100}%`,
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: editing ? "grab" : "default",
              touchAction: "none",
              maxWidth: "72%",
            }}
          >
            {/* Connector dot anchored exactly on the point */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 9,
                height: 9,
                borderRadius: radius.pill,
                background: color.cyan,
                boxShadow: `0 0 0 3px ${color.paper}, 0 0 0 4px ${color.cyan}`,
              }}
            />
            <span style={{ display: "inline-block", width: 10 }} aria-hidden="true" />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                maxWidth: "100%",
                padding: "3px 9px",
                borderRadius: radius.pill,
                background: color.paper,
                border: `1px solid ${color.borderStrong}`,
                boxShadow: elevation[2],
                color: color.inkSoft,
                fontFamily: font.sans,
                fontSize: 12,
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l.text}</span>
              {editing ? (
                <button
                  type="button"
                  aria-label={`Remove label ${l.text}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={removeLabel(l.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: color.muted,
                    cursor: "pointer",
                    fontFamily: font.mono,
                    fontSize: 13,
                    lineHeight: 1,
                    padding: 0,
                    marginLeft: 2,
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <input
            value={data.src}
            onChange={(e) => {
              setBroken(false);
              commit({ src: e.target.value });
            }}
            placeholder="Image URL…"
            aria-label="Image URL"
            style={inputStyle}
          />
          <input
            value={data.alt}
            onChange={(e) => commit({ alt: e.target.value })}
            placeholder="Alt text (accessibility)…"
            aria-label="Alt text"
            style={inputStyle}
          />
          <span style={{ color: color.muted, fontFamily: font.mono, fontSize: 10.5 }}>
            {hasImage ? "click the image to add a label · drag pills to move · × to remove" : "add an image, then click it to place labels"}
          </span>
        </div>
      ) : null}
    </figure>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  color: color.inkSoft,
  fontFamily: font.sans,
  fontSize: 13,
  padding: "6px 8px",
  outline: "none",
};
