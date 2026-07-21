/**
 * Server-safe block registry mirror. The client registry is `"use client"` +
 * next/dynamic, so it can't be imported here — these are the authoritative
 * registered type names (extracted from blocks/*), plus one-line shape hints the
 * model reads (D1). Emitting a type the client doesn't know = a blank hole (I1),
 * so this list must stay in sync with the block manifest.
 */
export const TEXT_TYPES = ["paragraph", "richtext", "heading", "subheading", "quote", "notes", "caption"] as const;
export const HEADING_TYPES = new Set<string>(["heading"]);
export const SUBHEADING_TYPES = new Set<string>(["subheading"]);
export const ADMONITION_TYPES = ["callout", "tip", "warning", "summary", "definition", "example"] as const;
export const LIST_TYPES = ["bullet", "numbered", "checklist"] as const;
export const MATH_TYPES = ["formula", "equation", "inline-equation", "display-equation"] as const;
export const VISUAL_TYPES = [
  "divider", "image", "table", "chart", "basic-diagram", "flow", "mermaid", "excalidraw",
  "tldraw", "graph", "monaco", "geometry", "mathfield", "threed", "physics", "molecule",
  "figure", "map", "timeline", "mindmap", "video", "audio", "gallery", "document", "embed",
] as const;

export const BLOCK_TYPES = [
  ...TEXT_TYPES, ...ADMONITION_TYPES, ...LIST_TYPES, ...MATH_TYPES, ...VISUAL_TYPES,
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_TYPES);

/** One-line shape hints the model sees in the tool description (D1). */
export const BLOCK_HINTS: Record<string, string> = {
  "text (paragraph/quote/notes/caption/richtext)": "{ text: string } — one paragraph of prose",
  "heading/subheading": "{ text: string } — a short title line",
  "admonition (callout/tip/warning/summary/definition/example)": "{ text: string } — a highlighted note",
  "bullet/numbered/checklist": "{ items: [{ text: string, checked?: boolean }] }",
  "formula/equation/inline-equation/display-equation": "{ latex: string } — valid KaTeX",
  chart: "{ kind: 'bar'|'line'|'area'|'pie'|'scatter', series: [{key:string}], data: [{label:string, value:number}], xKey?: string }",
  table: "{ headers: string[], rows: string[][] }",
  "basic-diagram": "{ nodes: [{id,x,y,label}], edges: [{id,from,to}] }",
  mermaid: "{ source: string } — valid Mermaid syntax (e.g. 'graph TD; A-->B')",
  flow: "{ nodes: [...], edges: [...] } — React Flow shape",
  graph: "{ fn: string } — a function of x, e.g. 'x^2'",
  mathfield: "{ latex: string }",
  divider: "{} — a horizontal rule",
  image: "{ src: string (https), alt?: string, caption?: string }",
  video: "{ src: string (https), poster?: string }",
  document: "{ url: string (https pdf) }",
  embed: "{ url: string (https), title?: string }",
  timeline: "{ items: [{ id: number, content: string, start: 'YYYY-MM-DD' }] } — dates must be ISO",
  mindmap: "{ markdown: string } — markdown headings only, e.g. '# Topic\\n## Branch A\\n### Leaf\\n## Branch B'",
  map: "{ center: [lng, lat], zoom: number, markers: [{ lng, lat, label }] } — lng FIRST",
  geometry: "{ points: [{id,x,y,name}], segments: [[fromId,toId]] } — for triangles, angles, constructions",
  molecule: "{ format: 'xyz', data: string } — XYZ text: line1 = atom count, line2 = name, then 'SYMBOL x y z' per line",
  threed: "{ shapes: [{ type: 'sphere'|'box', position: [x,y,z], color: '#hex' }] }",
  physics: "{ preset: 'gravity' } — a named simulation preset",
  figure: "{ src: string (https image), alt: string, labels: [{id,x,y,text}] } — x/y are 0..1 fractions. NEEDS a real image URL; skip this block if you do not have one",
  monaco: "{ code: string, language: string }",
  gallery: "{ images: [{ src, caption? }] }",
  audio: "{ src: string (https), title: string }",
};

// Two-tool split: text blocks go through emit_text, visuals through emit_visual.
// `formula` counts as a visual — it's what maths lessons need.
export const TEXT_ONLY_TYPES = [
  ...TEXT_TYPES, ...ADMONITION_TYPES, ...LIST_TYPES,
] as const;

export const VISUAL_ONLY_TYPES = [
  ...MATH_TYPES, ...VISUAL_TYPES,
] as const;
