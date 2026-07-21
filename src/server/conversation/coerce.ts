import { isText, FALLBACK_VISUAL } from "@/server/conversation/outline";

/**
 * RUNG 4 (repair) + RUNG 5 (minimal visual). The model's output is never
 * discarded: we keep what's usable and repair the shape; only when NOTHING is
 * salvageable do we build a minimal block. A VISUAL slot NEVER becomes a
 * paragraph — that is what turned failed lessons into walls of text. Paragraph
 * substitution stays reserved for text-family slots (handled here + validateBlock).
 */
export type CoerceStatus = "clean" | "repaired" | "minimal";
export interface Coerced {
  type: string; // may change at RUNG 5 (e.g. an un-fabricatable visual → mindmap)
  data: Record<string, unknown>;
  status: CoerceStatus;
}

const ISO = /^\d{4}(-\d{2}){0,2}$/; // YYYY | YYYY-MM | YYYY-MM-DD

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** True if a tool payload carries actual content (not `{}`, not `{markdown:""}`).
 *  An empty payload must NOT mark a slot resolved — else authorRate scores a
 *  lesson of empty shells at 1.0 (the hollow-metric trap). */
export function hasMeaningfulPayload(text: unknown, data: unknown): boolean {
  const t = typeof text === "string" ? text.trim() : "";
  if (t.length > 0) return true;
  const d = obj(data);
  return Object.values(d).some(
    (v) =>
      (typeof v === "string" && v.trim().length > 0) ||
      (Array.isArray(v) && v.length > 0) ||
      (typeof v === "number" && Number.isFinite(v)) ||
      (v !== null && typeof v === "object" && Object.keys(v as object).length > 0),
  );
}

const DEFAULT_TRIANGLE = {
  points: [
    { id: "A", x: 0, y: 0, name: "A" },
    { id: "B", x: 4, y: 0, name: "B" },
    { id: "C", x: 2, y: 3, name: "C" },
  ],
  segments: [["A", "B"], ["B", "C"], ["C", "A"]],
};

/**
 * Turn a (possibly malformed) slot payload into valid block data.
 * Returns the final type (usually unchanged), the data, and a status telling the
 * caller whether it was clean, repaired (RUNG 4), or fabricated minimal (RUNG 5).
 */
export function coerceSlot(type: string, rawData: unknown, text: string, intent: string): Coerced {
  const d = obj(rawData);
  const label = (intent || "this").slice(0, 60);

  // Text family → { text }. Only a text slot may fall back to prose.
  if (isText(type)) {
    const t = asStr(d.text ?? text).trim();
    if (t) return { type, data: { text: t }, status: "clean" };
    return { type, data: { text: label }, status: "minimal" };
  }

  // Math family → { latex }. Keep the type (a formula slot stays a formula).
  if (type === "formula" || type === "equation" || type === "inline-equation" || type === "display-equation") {
    const latex = asStr(d.latex ?? text).trim();
    if (latex) return { type, data: { latex }, status: "clean" };
    return { type, data: { latex: `\\text{${label.replace(/[\\{}$&#%_^~]/g, " ").trim() || "..."}}` }, status: "minimal" };
  }

  switch (type) {
    case "mindmap": {
      const md = asStr(d.markdown).trim();
      if (md) return { type, data: { markdown: md }, status: "clean" };
      const t = asStr(text).trim();
      if (t) return { type, data: { markdown: `# ${label}\n## ${t}` }, status: "repaired" };
      return { type, data: { markdown: `# ${label}` }, status: "minimal" };
    }

    case "timeline": {
      const raw = Array.isArray(d.items) ? d.items : [];
      let changed = false;
      const items = raw
        .map((it, i) => {
          const io = obj(it);
          const content = asStr(io.content ?? io.text).trim();
          if (!content) return null;
          let start = asStr(io.start).trim();
          if (start && !ISO.test(start)) {
            start = ""; // unparseable date → keep the label, drop the date
            changed = true;
          }
          const id = typeof io.id === "number" || typeof io.id === "string" ? io.id : i + 1;
          return { id, content, start };
        })
        .filter((x): x is { id: number | string; content: string; start: string } => x !== null);
      if (items.length >= 1) {
        return { type, data: { items }, status: changed || items.length !== raw.length ? "repaired" : "clean" };
      }
      return { type, data: { items: [{ id: 1, content: label, start: "" }] }, status: "minimal" };
    }

    case "table": {
      const headers = Array.isArray(d.headers) ? d.headers.map(asStr) : [];
      if (headers.length >= 1) {
        const w = headers.length;
        let changed = false;
        const rows = (Array.isArray(d.rows) ? d.rows : []).map((r) => {
          const row = Array.isArray(r) ? r.map(asStr) : [asStr(r)];
          if (row.length !== w) {
            changed = true;
            while (row.length < w) row.push("");
            row.length = w; // pad ragged rows to header length
          }
          return row;
        });
        return { type, data: { headers, rows }, status: changed ? "repaired" : "clean" };
      }
      return { type, data: { headers: [label], rows: [[""]] }, status: "minimal" };
    }

    case "chart": {
      const kind = ["bar", "line", "area", "pie", "scatter"].includes(asStr(d.kind)) ? asStr(d.kind) : "bar";
      const series = Array.isArray(d.series) && d.series.length ? d.series : [{ key: "value" }];
      const rawPts = Array.isArray(d.data) ? d.data : [];
      const pts = rawPts.filter((p) => Object.values(obj(p)).some((v) => typeof v === "number" && Number.isFinite(v)));
      if (pts.length >= 2) {
        const extra = typeof d.xKey === "string" ? { xKey: d.xKey } : {};
        return { type, data: { kind, series, data: pts, ...extra }, status: pts.length !== rawPts.length ? "repaired" : "clean" };
      }
      // minimal but VALID chart (never a paragraph)
      return {
        type,
        data: { kind: "bar", series: [{ key: "value" }], data: [{ label, value: 1 }, { label: "—", value: 1 }], xKey: "label" },
        status: "minimal",
      };
    }

    case "graph": {
      const fn = asStr(d.fn ?? d.expression).trim();
      if (fn) return { type, data: { fn }, status: "clean" };
      return { type, data: { fn: "x" }, status: "minimal" };
    }

    case "geometry": {
      const points = Array.isArray(d.points) ? d.points : [];
      if (points.length >= 2) return { type, data: d, status: "clean" };
      return { type, data: DEFAULT_TRIANGLE, status: "minimal" };
    }

    default: {
      // Any other visual with content → keep as-is; empty → downgrade to a
      // mindmap (universal, plain-markdown) so the slot stays visual, never prose.
      if (Object.keys(d).length > 0) return { type, data: d, status: "clean" };
      return { type: FALLBACK_VISUAL, data: { markdown: `# ${label}` }, status: "minimal" };
    }
  }
}
