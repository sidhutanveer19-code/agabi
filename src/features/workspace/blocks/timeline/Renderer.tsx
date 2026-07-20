"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Timeline } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { color, font, radius, space } from "@/config/tokens";

export interface TimelineItem {
  id: string | number;
  content: string;
  start: string;
}

export interface TimelineData {
  items: TimelineItem[];
}

/** Unique scope class so the dark-theme overrides never leak to other vis instances. */
const SCOPE = "agabi-vis-timeline";

/**
 * vis-timeline renderer (lazy-loaded). Present-only by default; in dev `editing`
 * a JSON textarea edits the items and persists through `onChange`. vis ships a
 * light default chrome, so we override background/text/borders to Agabi's dark
 * tokens via a scoped <style> block.
 */
export default function TimelineRenderer({ block, editing, onChange }: BlockRendererProps<TimelineData>) {
  const data = block.data ?? { items: [] };
  const items = data.items;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);

  const [parseError, setParseError] = useState<string | null>(null);

  // Serialize items for a stable dependency (avoids rebuild on identity churn).
  const itemsKey = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const timeline = new Timeline(el, items, { stack: true, height: "100%" });
    timelineRef.current = timeline;

    return () => {
      timeline.destroy();
      timelineRef.current = null;
    };
    // Rebuild only when the item set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  function commit(next: string) {
    try {
      const parsed: unknown = JSON.parse(next);
      if (!Array.isArray(parsed)) {
        setParseError("Expected an array of items.");
        return;
      }
      setParseError(null);
      onChange?.({ items: parsed as TimelineItem[] });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON.");
    }
  }

  return (
    <div
      role="img"
      aria-label="Event timeline"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <style>{`
        .${SCOPE} .vis-timeline { border: none; font-family: ${font.sans}; }
        .${SCOPE} .vis-panel.vis-center,
        .${SCOPE} .vis-panel.vis-left,
        .${SCOPE} .vis-panel.vis-right,
        .${SCOPE} .vis-panel.vis-top,
        .${SCOPE} .vis-panel.vis-bottom { border-color: ${color.border}; }
        .${SCOPE} .vis-time-axis .vis-grid.vis-minor { border-color: ${color.border}; }
        .${SCOPE} .vis-time-axis .vis-grid.vis-major { border-color: ${color.borderStrong}; }
        .${SCOPE} .vis-time-axis .vis-text { color: ${color.muted}; }
        .${SCOPE} .vis-time-axis .vis-text.vis-major { color: ${color.inkDim}; }
        .${SCOPE} .vis-labelset .vis-label,
        .${SCOPE} .vis-foreground .vis-group { border-color: ${color.border}; }
        .${SCOPE} .vis-item {
          background: ${color.violet};
          border-color: ${color.violet2};
          color: ${color.inkBright};
          border-radius: ${radius.sm}px;
        }
        .${SCOPE} .vis-item.vis-selected {
          background: ${color.violet2};
          border-color: ${color.violet3};
        }
        .${SCOPE} .vis-item .vis-item-content { color: ${color.inkBright}; }
        .${SCOPE} .vis-current-time { background-color: ${color.cyan}; }
        .${SCOPE} .vis-time-axis .vis-grid.vis-current-time { color: ${color.cyan}; }
        .${SCOPE} .vis-tooltip {
          background: ${color.surfaceActive};
          border: 1px solid ${color.border};
          color: ${color.ink};
          font-family: ${font.sans};
        }
      `}</style>

      <div className={SCOPE} ref={containerRef} style={{ flex: 1, minHeight: 0, width: "100%" }} />

      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            borderTop: `1px solid ${color.border}`,
            background: color.surface,
            padding: space[2],
            display: "flex",
            flexDirection: "column",
            gap: space[1],
          }}
        >
          <textarea
            aria-label="Edit timeline items as JSON"
            key={block.id}
            defaultValue={JSON.stringify(items, null, 2)}
            onChange={(e) => commit(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 96,
              resize: "vertical",
              boxSizing: "border-box",
              background: color.bg,
              color: color.inkSoft,
              border: `1px solid ${parseError ? color.danger : color.border}`,
              borderRadius: radius.sm,
              padding: space[2],
              fontFamily: font.mono,
              fontSize: 11,
              lineHeight: 1.5,
              outline: "none",
            }}
          />
          {parseError ? (
            <span style={{ color: color.danger, fontFamily: font.mono, fontSize: 10 }}>{parseError}</span>
          ) : (
            <span style={{ color: color.muted, fontFamily: font.mono, fontSize: 10 }}>
              {`{ id, content, start (ISO) }[]`}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
