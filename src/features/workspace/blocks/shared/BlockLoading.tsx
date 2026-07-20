"use client";

import { color, font } from "@/config/tokens";

/**
 * Calm loading state shown while a heavy visualization library lazy-loads.
 * Keeps the workspace feeling native (no raw library flash) during code-split.
 */
export function BlockLoading({ label }: { label?: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        borderRadius: 14,
        background: color.surface,
        border: `1px solid ${color.border}`,
        color: color.muted,
        fontFamily: font.mono,
        fontSize: 11,
      }}
    >
      <style>{`@keyframes agabiSpin{to{transform:rotate(360deg)}}`}</style>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: `2px solid ${color.border}`,
          borderTopColor: color.violet2,
          animation: "agabiSpin 0.7s linear infinite",
        }}
      />
      {label ?? "loading…"}
    </div>
  );
}
