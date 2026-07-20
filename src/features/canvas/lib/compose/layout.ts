import type { Lesson, LessonNode, TextNode } from "@/features/canvas/lib/lesson";
import { makeVariants, type LessonBrief } from "@/features/canvas/lib/compose/brief";

/** Greedy word-wrap to a max character width. */
function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= max) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textNode(
  x: number,
  y: number,
  fill: string,
  size: number,
  content: TextNode["content"]
): TextNode {
  return { t: "text", x, y, fill, size, content };
}

/**
 * Turn a text-only brief into a full handwritten Lesson. All variable text
 * routes through the 8 standard variant slots, so simpler/deeper/again keep
 * working exactly as they do for hand-authored lessons.
 */
export function layoutFromBrief(brief: LessonBrief): Lesson {
  const nodes: LessonNode[] = [];

  // ---- title + subtitle ----
  const titleLines = wrap(brief.title, 22).slice(0, 2);
  const titleNodes: TextNode[] = titleLines.map((ln, i) =>
    textNode(70, 108 + i * 62, "#F6F1E9", 52, ln)
  );
  const titleBottom = 108 + (titleLines.length - 1) * 62;
  nodes.push({
    t: "group",
    kind: "fade",
    dl: 0.2,
    hand: true,
    children: [
      ...titleNodes,
      textNode(70, titleBottom + 72, "#EDE8DF", 36, { slot: "subtitle" }),
    ],
  });

  // underline stroke beneath the title
  nodes.push({
    t: "path",
    kind: "stroke",
    dl: 0.5,
    dur: 0.9,
    d: `M64,${titleBottom + 20} C220,${titleBottom + 12} 470,${titleBottom + 14} 660,${titleBottom + 28}`,
    stroke: "#A78BFA",
    w: 3,
    cap: true,
    fill: "none",
  });

  // long horizontal rule across the board
  nodes.push({
    t: "path",
    kind: "stroke",
    dl: 0.8,
    dur: 1.1,
    d: "M70,470 L1270,470",
    stroke: "#EDE8DF",
    w: 1.6,
    cap: true,
    opacity: 0.35,
  });

  // ---- orange callouts (top right) ----
  nodes.push({
    t: "group",
    kind: "fade",
    dl: 2.4,
    hand: true,
    children: [
      textNode(950, 250, "#E8944E", 33, { slot: "cA0" }),
      textNode(982, 290, "#E8944E", 33, { slot: "cA1" }),
      {
        t: "path",
        d: "M944,306 C860,340 800,380 770,410",
        stroke: "#E8944E",
        w: 2.6,
        cap: true,
        fill: "none",
        marker: "O",
      },
    ],
  });

  // ---- key idea (center) ----
  nodes.push({
    t: "group",
    kind: "fade",
    dl: 3,
    hand: true,
    children: [
      textNode(150, 560, "#6FCF97", 40, "Key Idea"),
      textNode(310, 560, "#EDE8DF", 40, { slot: "keyTail" }),
    ],
  });

  // ---- definition box (lower center) ----
  const defLines = wrap(brief.definitionBody, 42).slice(0, 2);
  nodes.push({
    t: "group",
    kind: "fade",
    dl: 2.2,
    hand: true,
    children: [
      { t: "rect", x: 150, y: 690, w: 620, h: 170, rx: 14, fill: "rgba(217,195,107,.045)", stroke: "#D9C36B", sw: 2 },
      { t: "rect", x: 176, y: 676, w: 210, h: 28, fill: "#0a0c11" },
      textNode(184, 698, "#D9C36B", 30, brief.definitionLabel),
      ...defLines.map((ln, i) => textNode(184, 760 + i * 40, "#EDE8DF", 30, ln)),
    ],
  });

  // ---- right notes ----
  nodes.push({
    t: "group",
    kind: "fade",
    dl: 3.4,
    hand: true,
    children: [
      textNode(900, 660, "#EDE8DF", 31, { slot: "n1a" }),
      textNode(900, 696, "#EDE8DF", 31, { slot: "n1b" }),
      { t: "path", d: "M896,736 L938,736", stroke: "#EDE8DF", w: 2.4, cap: true, marker: "W" },
      textNode(950, 744, "#EDE8DF", 31, { slot: "n2a" }),
      textNode(950, 780, "#EDE8DF", 31, { slot: "n2b" }),
    ],
  });

  // a connective arrow from key idea toward the definition box
  nodes.push({
    t: "path",
    kind: "fade",
    dl: 3.2,
    d: "M300,590 C280,630 300,660 380,688",
    stroke: "#6FCF97",
    w: 2,
    cap: true,
    fill: "none",
    marker: "G",
  });

  return {
    id: `generated-${brief.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    subject: brief.subject,
    title: brief.title,
    viewBox: "0 0 1340 1000",
    nodes,
    variants: makeVariants(brief),
  };
}
