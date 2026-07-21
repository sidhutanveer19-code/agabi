import crypto from "node:crypto";
import { chartSchema, tableSchema, listSchema, mathSchema } from "@/server/ai/blockSchemas";
import { TEXT_TYPES, ADMONITION_TYPES, LIST_TYPES, MATH_TYPES, VISUAL_TYPES } from "@/server/ai/blockTypes";

/**
 * The validate + adapt ladder [I1]. The model emits SIMPLE shapes; this turns them
 * into the exact client block `data`, validates the constrained types, and — on any
 * failure — substitutes a markdown (paragraph) block so a lesson never renders a
 * blank hole. Every substitution is a fallback the caller logs (block.fallback).
 */
export interface AdaptedBlock {
  type: string;
  data: Record<string, unknown>;
  streamText?: string;
  fallback: boolean;
  reason?: string;
}

type Doc = { type: "doc"; content: unknown[] };

function paraDoc(text: string): Doc {
  return { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }] };
}
function headingDoc(level: number, text: string): Doc {
  return { type: "doc", content: [{ type: "heading", attrs: { level }, content: text ? [{ type: "text", text }] : undefined }] };
}
function itemId(): string {
  return `it_${crypto.randomBytes(6).toString("base64url")}`;
}
function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

const TEXT = new Set<string>(TEXT_TYPES);
const ADMON = new Set<string>(ADMONITION_TYPES);
const LIST = new Set<string>(LIST_TYPES);
const MATH = new Set<string>(MATH_TYPES);
const VISUAL = new Set<string>(VISUAL_TYPES);

/**
 * Fallback that never leaves a gap. Type-aware: a VISUAL slot degrades to a
 * minimal mindmap (still a visual), NEVER a paragraph — a wall of text in a
 * visual slot is the failure mode we are eliminating. Only text-family slots
 * fall back to a paragraph. (In the live path the coerce ladder repairs the
 * data before this ever runs; this is the last-ditch guard.)
 */
function substitute(originalType: string, text: string, reason: string): AdaptedBlock {
  if (VISUAL.has(originalType) || MATH.has(originalType)) {
    const body = text.trim();
    const markdown = body ? `# ${originalType}\n\n${body}` : `# ${originalType}`;
    return { type: "mindmap", data: { markdown }, fallback: true, reason };
  }
  const body = text.trim() || `(${originalType} could not be rendered)`;
  return { type: "paragraph", data: { doc: paraDoc(body) }, fallback: true, reason };
}

export function adaptBlock(type: string, rawData: unknown, streamText?: string): AdaptedBlock {
  try {
    const d = obj(rawData);
    const text = asStr(d.text ?? streamText ?? "");

    // Text family → ProseMirror doc (the model only supplies plain text).
    if (TEXT.has(type)) {
      if (type === "heading") return { type, data: { doc: headingDoc(1, text) }, fallback: false };
      if (type === "subheading") return { type, data: { doc: headingDoc(2, text) }, fallback: false };
      return { type, data: { doc: paraDoc(text) }, fallback: false };
    }
    if (ADMON.has(type)) return { type, data: { doc: paraDoc(text) }, fallback: false };

    // Math → { latex }
    if (MATH.has(type)) {
      const latex = asStr(d.latex ?? text);
      const r = mathSchema.safeParse({ latex });
      if (!r.success) return substitute(type, text, "math: empty/invalid latex");
      return { type, data: r.data, fallback: false };
    }

    // Lists → ensure item ids
    if (LIST.has(type)) {
      const rawItems = Array.isArray(d.items) ? d.items : [];
      const items = rawItems.map((it) => {
        const io = obj(it);
        return { id: asStr(io.id) || itemId(), text: asStr(io.text ?? it), checked: typeof io.checked === "boolean" ? io.checked : undefined };
      });
      const r = listSchema.safeParse({ items });
      if (!r.success) return substitute(type, text, "list: no valid items");
      return { type, data: r.data, fallback: false };
    }

    if (type === "chart") {
      const r = chartSchema.safeParse(d);
      if (!r.success) return substitute(type, streamText ?? "", "chart: invalid shape");
      return { type, data: r.data, fallback: false };
    }

    if (type === "table") {
      const headers = Array.isArray(d.headers) ? d.headers.map(asStr) : [];
      const rows = Array.isArray(d.rows) ? d.rows.map((row) => (Array.isArray(row) ? row.map(asStr) : [asStr(row)])) : [];
      const colWidths = Array.isArray(d.colWidths) ? d.colWidths.map((n) => Number(n) || 160) : headers.map(() => 160);
      const r = tableSchema.safeParse({ headers, rows, colWidths });
      if (!r.success) return substitute(type, streamText ?? "", "table: invalid shape");
      return { type, data: r.data, fallback: false };
    }

    if (type === "divider") return { type, data: {}, fallback: false };
    if (type === "graph") return { type, data: { fn: asStr(d.fn ?? d.expression ?? "x") }, fallback: false };
    if (type === "mermaid") {
      const source = asStr(d.source ?? d.code ?? "");
      if (!source) return substitute(type, streamText ?? "", "mermaid: empty");
      return { type, data: { source }, fallback: false };
    }

    // A visual block with empty data is a guaranteed blank hole → substitute.
    if (VISUAL.has(type) && Object.keys(d).length === 0) {
      return substitute(type, streamText ?? "", `${type}: empty data`);
    }
    // Other visual types with data: emit as-is; BlockErrorBoundary contains throws.
    return { type, data: d, streamText, fallback: false };
  } catch (err) {
    return substitute(type, streamText ?? "", `exception: ${(err as Error).message}`);
  }
}
