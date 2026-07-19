/**
 * Agabi lesson model — the domain-agnostic seam.
 *
 * A Lesson is pure data: an ordered list of drawable teaching primitives plus a
 * map of variant text. The <TeachingBoard/> renderer knows how to draw any
 * Lesson in the handwritten style; it contains NO subject-specific content.
 * The physics "projectile" lesson is simply the first dataset that plugs in.
 */

export type VariantKey = "normal" | "again1" | "again2" | "simpler" | "deeper";

/** The text slots that swap between teaching variants. */
export interface VariantSlots {
  subtitle: string;
  cA0: string;
  cA1: string;
  keyTail: string;
  n1a: string;
  n1b: string;
  n2a: string;
  n2b: string;
}

/** stroke = self-drawing line; fade = fades into place. */
export type DrawKind = "stroke" | "fade";

/** Arrowhead marker ids defined once by the board. */
export type MarkerId = "V" | "O" | "G" | "W";

/** Text content is either literal, or a reference to a swappable variant slot. */
export type Content = string | { slot: keyof VariantSlots };

export interface PathNode {
  t: "path";
  d: string;
  stroke: string;
  w: number;
  kind?: DrawKind; // only meaningful at top level; inside a group it inherits
  dl?: number; // seconds
  dur?: number; // seconds (stroke draw duration)
  cap?: boolean;
  join?: boolean;
  fill?: string;
  opacity?: number;
  dash?: string; // visual dash (fade nodes only), e.g. "3 9"
  marker?: MarkerId;
}

export interface TextNode {
  t: "text";
  x: number;
  y: number;
  fill: string;
  size: number;
  content: Content;
  anchor?: "start" | "middle" | "end";
}

export interface CircleNode {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  w?: number;
}

export interface RectNode {
  t: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  fill?: string;
  stroke?: string;
  sw?: number;
}

export type Leaf = PathNode | TextNode | CircleNode | RectNode;

/** A group shares one draw animation (fade/stroke) and optional inherited style. */
export interface GroupNode {
  t: "group";
  kind: DrawKind;
  dl: number;
  dur?: number;
  hand?: boolean; // handwriting font for text children
  stroke?: string;
  w?: number;
  cap?: boolean;
  join?: boolean;
  fill?: string;
  children: Leaf[];
}

export type LessonNode = Leaf | GroupNode;

export interface Lesson {
  id: string;
  subject: string;
  title: string;
  viewBox: string;
  nodes: LessonNode[];
  variants: Record<VariantKey, VariantSlots>;
}

/** Resolve a text node's content against the active variant. */
export function resolveContent(
  content: Content,
  slots: VariantSlots
): string {
  return typeof content === "string" ? content : slots[content.slot];
}
