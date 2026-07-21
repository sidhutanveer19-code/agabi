"use client";

import { useEffect, useState } from "react";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";

export interface GalleryImage {
  src: string;
  caption?: string;
}

export interface GalleryData {
  images: GalleryImage[];
}

/**
 * Image gallery (lazy-loaded). Responsive CSS grid of lazy <img>; clicking a
 * tile opens a full-block lightbox overlay. In dev `editing` mode a textarea
 * lets the author paste one image URL per line. Present mode is view-only.
 */
export default function GalleryRenderer({ block, editing, onChange }: BlockRendererProps<GalleryData>) {
  const data: GalleryData = block.data ?? { images: [] };
  const images = data.images ?? [];
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Close lightbox on Escape.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const setImagesFromText = (text: string) => {
    const next: GalleryImage[] = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((src, i) => ({ src, caption: images[i]?.caption }));
    onChange?.({ ...data, images: next });
  };

  const active = lightbox !== null ? images[lightbox] : undefined;

  return (
    <div
      role="group"
      aria-label="Image gallery"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {editing ? (
        <div style={{ padding: space[3], borderBottom: `1px solid ${color.border}` }}>
          <label
            style={{
              display: "block",
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: color.muted,
              marginBottom: space[2],
            }}
          >
            Image URLs — one per line
          </label>
          <textarea
            aria-label="Image URLs, one per line"
            defaultValue={images.map((im) => im.src).join("\n")}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => setImagesFromText(e.target.value)}
            placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/photo-2.jpg"}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 76,
              resize: "vertical",
              boxSizing: "border-box",
              padding: space[2],
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.ink,
              fontFamily: font.mono,
              fontSize: 12,
              lineHeight: 1.6,
              outline: "none",
            }}
          />
        </div>
      ) : null}

      {images.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: space[4],
            color: color.muted,
            fontFamily: font.sans,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {editing ? "Add image URLs above." : "No images yet."}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: space[3],
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: space[2],
            alignContent: "start",
          }}
        >
          {images.map((im, i) => (
            <button
              key={`${im.src}-${i}`}
              type="button"
              aria-label={im.caption ? `Open image: ${im.caption}` : `Open image ${i + 1}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setLightbox(i)}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                padding: 0,
                border: `1px solid ${color.border}`,
                borderRadius: radius.md,
                overflow: "hidden",
                background: color.surface,
                cursor: "pointer",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={safeUrl(im.src, "image") ?? ""}
                alt={im.caption ?? `Gallery image ${i + 1}`}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {im.caption ? (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: `${space[1]}px ${space[2]}px`,
                    background: "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))",
                    color: color.inkBright,
                    fontFamily: font.sans,
                    fontSize: 11,
                    lineHeight: 1.3,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {im.caption}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.caption ? `Image: ${active.caption}` : "Image preview"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setLightbox(null)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: space[3],
            padding: space[4],
            background: "rgba(0,0,0,0.82)",
            backdropFilter: "blur(4px)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={safeUrl(active.src, "image") ?? ""}
            alt={active.caption ?? "Preview"}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%",
              maxHeight: active.caption ? "82%" : "92%",
              objectFit: "contain",
              borderRadius: radius.md,
              boxShadow: "0 14px 40px rgba(0,0,0,.45)",
            }}
          />
          {active.caption ? (
            <p
              style={{
                margin: 0,
                maxWidth: 640,
                textAlign: "center",
                color: color.inkSoft,
                fontFamily: font.sans,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {active.caption}
            </p>
          ) : null}
          <button
            type="button"
            aria-label="Close preview"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            style={{
              position: "absolute",
              top: space[3],
              right: space[3],
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.pill,
              border: `1px solid ${color.borderStrong}`,
              background: color.surface,
              color: color.ink,
              fontFamily: font.sans,
              fontSize: 16,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
