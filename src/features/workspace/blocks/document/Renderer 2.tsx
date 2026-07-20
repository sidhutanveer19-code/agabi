"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

// pdf.js needs a worker; pin it to the exact bundled version (react-pdf v10).
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export interface DocumentData {
  url: string;
}

/** react-pdf viewer (lazy-loaded). URL-editable in dev, present-only otherwise. */
export default function DocumentRenderer({ block, editing, onChange }: BlockRendererProps<DocumentData>) {
  const data = block.data ?? { url: "" };
  const url = data.url;

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Measure the container so the page renders at full width.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onLoad = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPage((p) => Math.min(Math.max(1, p), n));
    setError(null);
  }, []);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      role="document"
      aria-label="PDF document"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
        fontFamily: font.sans,
      }}
    >
      {editing ? (
        <div
          onPointerDown={stop}
          style={{
            display: "flex",
            gap: space[2],
            padding: space[2],
            borderBottom: `1px solid ${color.border}`,
            background: color.surface,
          }}
        >
          <input
            type="url"
            value={url}
            placeholder="https://example.com/file.pdf"
            aria-label="PDF URL"
            onPointerDown={stop}
            onChange={(e) => onChange?.({ ...data, url: e.target.value })}
            style={{
              flex: 1,
              minWidth: 0,
              padding: `${space[1]}px ${space[2]}px`,
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: color.bg,
              color: color.ink,
              fontFamily: font.mono,
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>
      ) : null}

      <div
        ref={wrapRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: color.bg,
          padding: space[3],
        }}
      >
        {!url ? (
          <div
            style={{
              margin: "auto",
              color: color.muted,
              fontFamily: font.mono,
              fontSize: 12,
              textAlign: "center",
            }}
          >
            No document. {editing ? "Paste a PDF URL above." : "Empty."}
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={onLoad}
            onLoadError={(e: Error) => setError(e.message)}
            loading={
              <div style={{ margin: "auto", color: color.muted, fontFamily: font.mono, fontSize: 12 }}>
                loading PDF…
              </div>
            }
            error={
              <div style={{ margin: "auto", color: color.danger, fontFamily: font.mono, fontSize: 12 }}>
                {error ?? "Failed to load PDF."}
              </div>
            }
          >
            {width > 0 ? <Page pageNumber={page} width={width} /> : null}
          </Document>
        )}
      </div>

      {numPages > 1 ? (
        <div
          onPointerDown={stop}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: space[3],
            padding: space[2],
            borderTop: `1px solid ${color.border}`,
            background: color.surface,
            color: color.inkDim,
            fontFamily: font.mono,
            fontSize: 12,
          }}
        >
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onPointerDown={stop}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={navBtn(page <= 1)}
          >
            ‹
          </button>
          <span aria-live="polite">
            {page} / {numPages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= numPages}
            onPointerDown={stop}
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            style={navBtn(page >= numPages)}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    border: `1px solid ${color.border}`,
    background: disabled ? "transparent" : color.surfaceHover,
    color: disabled ? color.muted2 : color.ink,
    cursor: disabled ? "default" : "pointer",
    fontSize: 16,
    lineHeight: 1,
    opacity: disabled ? 0.5 : 1,
  };
}
