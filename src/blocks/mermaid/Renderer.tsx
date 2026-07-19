"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";
import { color, font } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { MermaidData } from "./schema";

const THEME = {
  startOnLoad: false,
  theme: "dark" as const,
  securityLevel: "strict" as const,
  themeVariables: {
    background: "transparent",
    primaryColor: "#12141c",
    primaryTextColor: "#f3eee6",
    primaryBorderColor: "#3a3f4d",
    lineColor: "#a78bfa",
    fontFamily: "var(--font-sans, sans-serif)",
  },
};

export function Renderer({ data }: BlockRendererProps<MermaidData>) {
  const [svg, setSvg] = useState("");
  const id = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let alive = true;
    mermaid.initialize(THEME);
    mermaid
      .render(id, data.code)
      .then((res) => alive && setSvg(res.svg))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [data.code, id]);

  if (!svg) {
    return (
      <div style={{ color: color.muted, fontFamily: font.sans, fontSize: 13 }}>
        Rendering diagram…
      </div>
    );
  }
  // mermaid output is generated from our own source with securityLevel:strict
  return <div style={{ fontFamily: font.sans }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
