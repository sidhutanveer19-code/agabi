"use client";

import { Video as VideoIcon } from "lucide-react";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";

export interface VideoData {
  src: string;
  poster: string;
  captionsSrc?: string;
}

const inputStyle: React.CSSProperties = {
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

/**
 * Native HTML5 <video> renderer (lazy-loaded, code-split by next/dynamic).
 * Present mode plays the video; dev/editing exposes URL inputs that persist
 * into the block's `data`. Themed to Agabi dark tokens with rounded corners.
 */
export default function VideoRenderer({ block, editing, onChange }: BlockRendererProps<VideoData>) {
  const data: VideoData = block.data ?? { src: "", poster: "", captionsSrc: "" };
  // Untrusted URLs — scheme-guard every media/image sink.
  const videoSrc = safeUrl(data.src, "media");
  const posterSrc = safeUrl(data.poster, "image");
  const captionsSrc = safeUrl(data.captionsSrc, "media");

  return (
    <figure
      role="group"
      aria-label="Video"
      style={{
        width: "100%",
        height: "100%",
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflow: "auto",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          background: color.surface,
          border: `1px solid ${color.border}`,
          overflow: "hidden",
          minHeight: 60,
        }}
      >
        {videoSrc ? (
          <video
            controls
            preload="metadata"
            poster={posterSrc || undefined}
            aria-label="Video player"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              borderRadius: radius.md,
              background: color.bg,
            }}
          >
            <source src={videoSrc} />
            {captionsSrc ? (
              <track kind="captions" src={captionsSrc} srcLang="en" label="Captions" default />
            ) : null}
          </video>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              color: color.muted,
              fontFamily: font.mono,
              fontSize: 11,
            }}
          >
            <VideoIcon size={20} />
            add a video URL
          </div>
        )}
      </div>

      {editing ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            value={data.src}
            onChange={(e) => onChange?.({ ...data, src: e.target.value })}
            placeholder="Video URL (.mp4/.webm)…"
            aria-label="Video source URL"
            style={inputStyle}
          />
          <input
            value={data.poster}
            onChange={(e) => onChange?.({ ...data, poster: e.target.value })}
            placeholder="Poster image URL…"
            aria-label="Poster image URL"
            style={inputStyle}
          />
          <input
            value={data.captionsSrc ?? ""}
            onChange={(e) => onChange?.({ ...data, captionsSrc: e.target.value })}
            placeholder="Captions URL (.vtt, optional)…"
            aria-label="Captions track URL"
            style={inputStyle}
          />
        </div>
      ) : null}
    </figure>
  );
}
