"use client";

import Editor from "@monaco-editor/react";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius } from "@/config/tokens";

export interface MonacoData {
  code: string;
  language: string;
}

/** Monaco code editor (lazy-loaded). Editable in dev, read-only in present. */
export default function MonacoRenderer({ block, editing, onChange }: BlockRendererProps<MonacoData>) {
  const data = block.data ?? { code: "", language: "javascript" };
  const { code, language } = data;

  return (
    <div
      role="group"
      aria-label={`Code editor (${language})`}
      onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
        fontFamily: font.mono,
      }}
    >
      <Editor
        height="100%"
        theme="vs-dark"
        language={language}
        value={code}
        onChange={editing ? (v) => onChange?.({ code: v ?? "", language }) : undefined}
        options={{
          readOnly: !editing,
          minimap: { enabled: false },
          wordWrap: "on",
          fontSize: 13,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
