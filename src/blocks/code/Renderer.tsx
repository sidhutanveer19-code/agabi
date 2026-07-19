"use client";

import Editor from "@monaco-editor/react";
import { color, radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { CodeData } from "./schema";

export function Renderer({ data }: BlockRendererProps<CodeData>) {
  return (
    <div
      style={{
        height: 280,
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
      }}
    >
      <Editor
        height="280px"
        language={data.language}
        value={data.code}
        theme="vs-dark"
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          renderLineHighlight: "none",
          padding: { top: 12, bottom: 12 },
          fontFamily: "var(--font-mono, monospace)",
        }}
      />
    </div>
  );
}
