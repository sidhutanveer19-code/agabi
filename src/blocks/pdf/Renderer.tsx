"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { color, font, radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { PdfData } from "./schema";

// Worker as a runtime URL (kept out of the bundle). Self-host for production/offline.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export function Renderer({ data }: BlockRendererProps<PdfData>) {
  const [pages, setPages] = useState(0);

  if (!data.src) {
    return (
      <div
        style={{
          padding: 18,
          border: `1px dashed ${color.border}`,
          borderRadius: radius.lg,
          color: color.muted,
          fontFamily: font.sans,
          fontSize: 14,
        }}
      >
        No PDF loaded. Supply a document URL to preview it here.
      </div>
    );
  }

  return (
    <div className="ds-scroll" style={{ maxHeight: 420, overflow: "auto", borderRadius: radius.lg }}>
      <Document
        file={data.src}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        loading={<div style={{ color: color.muted, fontFamily: font.sans }}>Loading PDF…</div>}
      >
        {Array.from({ length: pages }, (_, i) => (
          <Page key={i} pageNumber={i + 1} width={520} />
        ))}
      </Document>
    </div>
  );
}
