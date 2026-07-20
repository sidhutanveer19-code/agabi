import type { JSONContent } from "@tiptap/core";
import { color } from "@/config/tokens";

/**
 * Builders for real block `data` payloads used by the mock lesson plans. These
 * produce the exact shapes the Phase 3/4 blocks expect, so streamed content
 * renders through the unchanged block system.
 */

const doc = (...nodes: JSONContent[]): JSONContent => ({ type: "doc", content: nodes });
const para = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : undefined,
});
const heading = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: text ? [{ type: "text", text }] : undefined,
});

/** text-family block data ({ doc }). */
export function textData(text: string): { doc: JSONContent } {
  return { doc: doc(para(text)) };
}
export function headingData(text: string): { doc: JSONContent } {
  return { doc: doc(heading(1, text)) };
}
export function subheadingData(text: string): { doc: JSONContent } {
  return { doc: doc(heading(2, text)) };
}
/** admonition-family block data ({ doc }) — summary/callout/tip/etc. */
export function admonitionData(text: string): { doc: JSONContent } {
  return { doc: doc(para(text)) };
}

/** math block data. */
export function formulaData(latex: string): { latex: string } {
  return { latex };
}

/** chart block data. */
export function barChartData(rows: { label: string; value: number }[]): {
  kind: string;
  series: { key: string; color: string }[];
  data: { label: string; value: number }[];
  xKey: string;
} {
  return { kind: "bar", series: [{ key: "value", color: color.violet2 }], data: rows, xKey: "label" };
}

/** basic-diagram block data. */
export function diagramData(
  nodes: { id: string; x: number; y: number; label: string }[],
  edges: { id: string; from: string; to: string }[]
): { nodes: typeof nodes; edges: typeof edges } {
  return { nodes, edges };
}
