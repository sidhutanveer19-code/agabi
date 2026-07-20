"use client";

import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export interface AudioData {
  src: string;
  title: string;
}

/** Native HTML5 audio player (lazy-loaded). Editable src/title in dev, present-only otherwise. */
export default function AudioRenderer({ block, editing, onChange }: BlockRendererProps<AudioData>) {
  const data = block.data ?? { src: "", title: "" };
  const set = (p: Partial<AudioData>) => onChange?.({ ...data, ...p });

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      role="group"
      aria-label={data.title ? `Audio: ${data.title}` : "Audio player"}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: space[3],
        boxSizing: "border-box",
        padding: space[4],
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.paper,
        color: color.ink,
        fontFamily: font.sans,
        overflow: "hidden",
      }}
    >
      {editing ? (
        <>
          <input
            aria-label="Audio title"
            value={data.title}
            placeholder="Title"
            onPointerDown={stop}
            onChange={(e) => set({ title: e.target.value })}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: `${space[2]}px ${space[3]}px`,
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.ink,
              fontFamily: font.sans,
              fontSize: 14,
              outline: "none",
            }}
          />
          <input
            aria-label="Audio source URL"
            value={data.src}
            placeholder="https://…/audio.mp3"
            onPointerDown={stop}
            onChange={(e) => set({ src: e.target.value })}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: `${space[2]}px ${space[3]}px`,
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.muted3,
              fontFamily: font.mono,
              fontSize: 12,
              outline: "none",
            }}
          />
        </>
      ) : (
        <div
          style={{
            fontFamily: font.display,
            fontSize: 16,
            color: color.inkBright,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.title || "Untitled audio"}
        </div>
      )}

      {data.src ? (
        <audio
          controls
          src={data.src}
          onPointerDown={stop}
          aria-label={data.title || "Audio track"}
          style={{ width: "100%", colorScheme: "dark" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: `${space[4]}px ${space[3]}px`,
            borderRadius: radius.sm,
            border: `1px dashed ${color.border}`,
            background: color.surface,
            color: color.muted,
            fontFamily: font.mono,
            fontSize: 12,
          }}
        >
          {editing ? "Paste an audio URL above" : "No audio source"}
        </div>
      )}
    </div>
  );
}
