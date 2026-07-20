import type { Lesson } from "@/features/canvas/lib/lesson";

/** Math lesson — solving quadratic equations. Hand-authored, fully data-driven. */
export const quadraticLesson: Lesson = {
  id: "quadratic-equations",
  subject: "Mathematics",
  title: "Solving quadratic equations",
  viewBox: "0 0 1340 1000",
  nodes: [
    // axes + parabola
    { t: "path", kind: "stroke", dl: 0.5, dur: 1, d: "M200,560 L1140,560", stroke: "#EDE8DF", w: 2.2, cap: true },
    { t: "path", kind: "stroke", dl: 0.7, dur: 0.8, d: "M670,320 L670,650", stroke: "#EDE8DF", w: 1.4, cap: true, opacity: 0.4 },
    { t: "path", kind: "stroke", dl: 0.9, dur: 1.8, d: "M330,330 Q670,900 1010,330", stroke: "#A78BFA", w: 3, cap: true, fill: "none" },
    { t: "path", kind: "fade", dl: 2.4, d: "M670,360 L670,600", stroke: "#6FCF97", w: 2, dash: "3 9", cap: true, opacity: 0.85 },

    // title
    {
      t: "group",
      kind: "fade",
      dl: 0.2,
      hand: true,
      children: [
        { t: "text", x: 70, y: 100, fill: "#F6F1E9", size: 50, content: "Solving quadratic" },
        { t: "text", x: 70, y: 158, fill: "#F6F1E9", size: 50, content: "equations" },
        { t: "text", x: 70, y: 232, fill: "#EDE8DF", size: 36, content: { slot: "subtitle" } },
      ],
    },

    // root + vertex markers
    {
      t: "group",
      kind: "fade",
      dl: 1.9,
      children: [
        { t: "circle", cx: 520, cy: 560, r: 11, fill: "#0a0c11", stroke: "#EDE8DF", w: 2.4 },
        { t: "circle", cx: 820, cy: 560, r: 11, fill: "#0a0c11", stroke: "#EDE8DF", w: 2.4 },
        { t: "circle", cx: 670, cy: 615, r: 11, fill: "#0a0c11", stroke: "#6FCF97", w: 2.4 },
      ],
    },
    {
      t: "group",
      kind: "fade",
      dl: 2.1,
      hand: true,
      children: [
        { t: "text", x: 496, y: 604, fill: "#A78BFA", size: 30, content: "x₁" },
        { t: "text", x: 828, y: 604, fill: "#A78BFA", size: 30, content: "x₂" },
        { t: "text", x: 694, y: 656, fill: "#6FCF97", size: 28, content: "vertex" },
      ],
    },

    // key idea (left)
    {
      t: "group",
      kind: "fade",
      dl: 3,
      hand: true,
      children: [
        { t: "text", x: 96, y: 430, fill: "#6FCF97", size: 38, content: "Key Idea" },
        { t: "text", x: 250, y: 430, fill: "#EDE8DF", size: 38, content: { slot: "keyTail" } },
      ],
    },

    // orange callouts (top right)
    {
      t: "group",
      kind: "fade",
      dl: 2.6,
      hand: true,
      children: [
        { t: "text", x: 980, y: 250, fill: "#E8944E", size: 33, content: { slot: "cA0" } },
        { t: "text", x: 1012, y: 290, fill: "#E8944E", size: 33, content: { slot: "cA1" } },
        { t: "path", d: "M974,306 C930,340 890,360 862,392", stroke: "#E8944E", w: 2.6, cap: true, fill: "none", marker: "O" },
      ],
    },

    // right notes
    {
      t: "group",
      kind: "fade",
      dl: 3.4,
      hand: true,
      children: [
        { t: "text", x: 980, y: 430, fill: "#EDE8DF", size: 31, content: { slot: "n1a" } },
        { t: "text", x: 980, y: 466, fill: "#EDE8DF", size: 31, content: { slot: "n1b" } },
        { t: "path", d: "M976,506 L1018,506", stroke: "#EDE8DF", w: 2.4, cap: true, marker: "W" },
        { t: "text", x: 1000, y: 546, fill: "#EDE8DF", size: 31, content: { slot: "n2a" } },
        { t: "text", x: 1000, y: 582, fill: "#EDE8DF", size: 31, content: { slot: "n2b" } },
      ],
    },

    // formula box
    {
      t: "group",
      kind: "fade",
      dl: 3.5,
      hand: true,
      children: [
        { t: "rect", x: 430, y: 700, w: 500, h: 178, rx: 14, fill: "rgba(217,195,107,.045)", stroke: "#D9C36B", sw: 2 },
        { t: "rect", x: 454, y: 686, w: 130, h: 28, fill: "#0a0c11" },
        { t: "text", x: 462, y: 708, fill: "#D9C36B", size: 30, content: "Formula" },
        { t: "text", x: 486, y: 772, fill: "#EDE8DF", size: 38, content: "ax² + bx + c = 0" },
        { t: "text", x: 470, y: 838, fill: "#EDE8DF", size: 34, content: "x = (−b ± √(b²−4ac)) / 2a" },
      ],
    },
  ],

  variants: {
    normal: {
      subtitle: "The graph is a parabola — where it crosses zero are the answers.",
      cA0: "Two crossings",
      cA1: "= two roots.",
      keyTail: ": the roots are where y = 0.",
      n1a: "The vertex is the",
      n1b: "tip of the curve.",
      n2a: "b²−4ac tells you",
      n2b: "how many roots.",
    },
    again1: {
      subtitle: "Same idea — think of it as factoring.",
      cA0: "(x − x₁)(x − x₂)",
      cA1: "= 0.",
      keyTail: ": each factor gives one root.",
      n1a: "Roots multiply",
      n1b: "to c / a.",
      n2a: "Roots add",
      n2b: "to −b / a.",
    },
    again2: {
      subtitle: "Or just complete the square.",
      cA0: "Shift and",
      cA1: "reshape it.",
      keyTail: ": rewrite until x stands alone.",
      n1a: "Move c across,",
      n1b: "halve b, square it.",
      n2a: "Then take the",
      n2b: "square root.",
    },
    simpler: {
      subtitle: "Where does the U-shape touch the ground?",
      cA0: "Touch points",
      cA1: "are the answers.",
      keyTail: ": find where it hits zero.",
      n1a: "Down then up —",
      n1b: "that's a parabola.",
      n2a: "The bottom point",
      n2b: "is the vertex.",
    },
    deeper: {
      subtitle: "The discriminant decides everything.",
      cA0: "b²−4ac > 0",
      cA1: "→ two real roots.",
      keyTail: ": the sign of b²−4ac fixes the root count.",
      n1a: "= 0 → one root,",
      n1b: "< 0 → complex.",
      n2a: "Vertex sits at",
      n2b: "x = −b / 2a.",
    },
  },
};
