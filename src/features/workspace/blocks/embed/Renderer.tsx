"use client";

import { Globe } from "lucide-react";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";

export interface EmbedData {
  url: string;
  title: string;
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
 * Generic secure embed renderer (lazy-loaded, code-split by next/dynamic).
 * Present mode shows the sandboxed iframe; dev/editing exposes URL + title
 * inputs that persist into the block's `data`. Themed to Agabi dark tokens.
 *
 * SECURITY: the URL is scheme-validated (`safeUrl` → https/http only) before it
 * reaches the iframe. The sandbox omits `allow-same-origin` (so framed content
 * can never reach out of its sandbox) and `allow-top-navigation` (so it can't
 * navigate the host workspace). `referrerPolicy="no-referrer"` prevents URL leak.
 */
export default function EmbedRenderer({ block, editing, onChange }: BlockRendererProps<EmbedData>) {
  const data: EmbedData = block.data ?? { url: "", title: "" };
  // Untrusted (possibly AI-streamed) URL — only https/http frames are allowed.
  const frameSrc = safeUrl(data.url, "frame");

  return (
    <figure
      role="group"
      aria-label={data.title || "Embed"}
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
        {frameSrc ? (
          <iframe
            src={frameSrc}
            title={data.title || "Embedded content"}
            sandbox="allow-scripts allow-popups allow-forms"
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
              borderRadius: radius.md,
              background: color.bg,
            }}
          />
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
            <Globe size={20} />
            {data.url ? "blocked: only https embeds are allowed" : "add an embed URL"}
          </div>
        )}
      </div>

      {editing ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            value={data.url}
            onChange={(e) => onChange?.({ ...data, url: e.target.value })}
            placeholder="Embed URL (https://…)…"
            aria-label="Embed URL"
            style={inputStyle}
          />
          <input
            value={data.title}
            onChange={(e) => onChange?.({ ...data, title: e.target.value })}
            placeholder="Title (for accessibility)…"
            aria-label="Embed title"
            style={inputStyle}
          />
        </div>
      ) : null}
    </figure>
  );
}
