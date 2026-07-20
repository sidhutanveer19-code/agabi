import type { Lesson } from "@/features/canvas/lib/lesson";

/** Geometry lesson — the Pythagorean theorem. Hand-authored, fully data-driven. */
export const pythagoreanLesson: Lesson = {
  id: "pythagorean-theorem",
  subject: "Mathematics",
  title: "The Pythagorean theorem",
  viewBox: "0 0 1340 1000",
  nodes: [
    // squares on the two legs
    { t: "path", kind: "stroke", dl: 0.6, dur: 1.1, d: "M430,560 L430,320 L190,320 L190,560 Z", stroke: "#A78BFA", w: 2.4, cap: true, join: true, fill: "none" },
    { t: "path", kind: "stroke", dl: 0.9, dur: 1.3, d: "M430,560 L770,560 L770,900 L430,900 Z", stroke: "#38BDF8", w: 2.4, cap: true, join: true, fill: "none" },
    // triangle
    { t: "path", kind: "stroke", dl: 1.3, dur: 1, d: "M430,560 L430,320 L770,560 Z", stroke: "#EDE8DF", w: 2.8, cap: true, join: true, fill: "none" },
    // right-angle marker
    { t: "path", kind: "stroke", dl: 1.7, dur: 0.5, d: "M430,535 L455,535 L455,560", stroke: "#EDE8DF", w: 2, cap: true, fill: "none" },

    // title
    {
      t: "group",
      kind: "fade",
      dl: 0.2,
      hand: true,
      children: [
        { t: "text", x: 70, y: 100, fill: "#F6F1E9", size: 50, content: "The Pythagorean" },
        { t: "text", x: 70, y: 158, fill: "#F6F1E9", size: 50, content: "theorem" },
        { t: "text", x: 70, y: 232, fill: "#EDE8DF", size: 36, content: { slot: "subtitle" } },
      ],
    },

    // side + square labels
    {
      t: "group",
      kind: "fade",
      dl: 1.9,
      hand: true,
      children: [
        { t: "text", x: 285, y: 455, fill: "#A78BFA", size: 40, content: "a²" },
        { t: "text", x: 585, y: 745, fill: "#38BDF8", size: 40, content: "b²" },
        { t: "text", x: 612, y: 424, fill: "#EDE8DF", size: 34, content: "c" },
        { t: "text", x: 388, y: 445, fill: "#B39DDB", size: 28, content: "a" },
        { t: "text", x: 588, y: 600, fill: "#7DD3FC", size: 28, content: "b" },
      ],
    },

    // formula box (top right)
    {
      t: "group",
      kind: "fade",
      dl: 2.2,
      hand: true,
      children: [
        { t: "rect", x: 880, y: 120, w: 400, h: 150, rx: 14, fill: "rgba(217,195,107,.045)", stroke: "#D9C36B", sw: 2 },
        { t: "rect", x: 904, y: 106, w: 130, h: 28, fill: "#0a0c11" },
        { t: "text", x: 912, y: 128, fill: "#D9C36B", size: 30, content: "Theorem" },
        { t: "text", x: 940, y: 215, fill: "#EDE8DF", size: 48, content: "a² + b² = c²" },
      ],
    },

    // orange callouts (right)
    {
      t: "group",
      kind: "fade",
      dl: 2.6,
      hand: true,
      children: [
        { t: "text", x: 900, y: 350, fill: "#E8944E", size: 33, content: { slot: "cA0" } },
        { t: "text", x: 932, y: 390, fill: "#E8944E", size: 33, content: { slot: "cA1" } },
        { t: "path", d: "M894,406 C820,440 760,460 700,470", stroke: "#E8944E", w: 2.6, cap: true, fill: "none", marker: "O" },
      ],
    },

    // key idea (right middle)
    {
      t: "group",
      kind: "fade",
      dl: 3,
      hand: true,
      children: [
        { t: "text", x: 110, y: 650, fill: "#6FCF97", size: 38, content: "Key Idea" },
        { t: "text", x: 264, y: 650, fill: "#EDE8DF", size: 34, content: { slot: "keyTail" } },
      ],
    },

    // right notes
    {
      t: "group",
      kind: "fade",
      dl: 3.4,
      hand: true,
      children: [
        { t: "text", x: 900, y: 700, fill: "#EDE8DF", size: 31, content: { slot: "n1a" } },
        { t: "text", x: 900, y: 736, fill: "#EDE8DF", size: 31, content: { slot: "n1b" } },
        { t: "path", d: "M896,776 L938,776", stroke: "#EDE8DF", w: 2.4, cap: true, marker: "W" },
        { t: "text", x: 950, y: 784, fill: "#EDE8DF", size: 31, content: { slot: "n2a" } },
        { t: "text", x: 950, y: 820, fill: "#EDE8DF", size: 31, content: { slot: "n2b" } },
      ],
    },
  ],

  variants: {
    normal: {
      subtitle: "In a right triangle, the three sides lock together.",
      cA0: "The long side",
      cA1: "faces the corner.",
      keyTail: ": the two small squares fill the big one.",
      n1a: "a and b are",
      n1b: "the legs.",
      n2a: "c is the",
      n2b: "hypotenuse.",
    },
    again1: {
      subtitle: "Same idea — read it as areas.",
      cA0: "Area a² plus",
      cA1: "area b².",
      keyTail: ": their areas add to area c².",
      n1a: "Each square sits",
      n1b: "on one side.",
      n2a: "Big square = sum",
      n2b: "of the two.",
    },
    again2: {
      subtitle: "Or read it as a distance.",
      cA0: "Horizontal b,",
      cA1: "vertical a.",
      keyTail: ": the straight path is √(a²+b²).",
      n1a: "Legs give the",
      n1b: "two directions.",
      n2a: "Hypotenuse is",
      n2b: "the shortcut.",
    },
    simpler: {
      subtitle: "Two small squares equal one big square.",
      cA0: "Add the",
      cA1: "small ones.",
      keyTail: ": that sum is the big square.",
      n1a: "The corner is",
      n1b: "a right angle.",
      n2a: "Opposite it sits",
      n2b: "the longest side.",
    },
    deeper: {
      subtitle: "It holds only when one angle is exactly 90°.",
      cA0: "Right angle",
      cA1: "→ a²+b²=c².",
      keyTail: ": drop the right angle and it fails.",
      n1a: "Converse: if it",
      n1b: "holds, angle is 90°.",
      n2a: "Extends to the",
      n2b: "distance formula.",
    },
  },
};
