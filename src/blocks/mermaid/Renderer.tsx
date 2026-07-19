"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { color, font } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { MermaidData } from "./schema";

let inited = false;
function ensureInit() {
  if (inited) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    themeVariables: {
      background: "transparent",
      primaryColor: "#12141c",
      primaryTextColor: "#f3eee6",
      primaryBorderColor: "#3a3f4d",
      lineColor: "#a78bfa",
      fontFamily: "var(--font-sans, sans-serif)",
    },
  });
  inited = true;
}

export function Renderer({ data }: BlockRendererProps<MermaidData>) {
  const [svg, setSvg] = useState("");
  const idRef = useRef("mmd-" + Math.random().toString(36).slice(2));

  useEffect(() => {
    ensureInit();
    let alive = true;
    mermaid
      .render(idRef.current, data.code)
      .then((res) => {
        if (alive) setSvg(res.svg);
      })
      .catch(() => setSvg(""));
    return () => {
      alive = false;
    };
  }, [data.code]);

  if (!svg) {
    return (
      <div style={{ color: color.muted, fontFamily: font.sans, fontSize: 13 }}>
        Rendering diagram…
      </div>
    );
  }
  // mermaid output is generated from our own diagram source with securityLevel:strict
  return <div style={{ fontFamily: font.sans }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
