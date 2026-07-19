import type { BlockInstance, WorkspaceDoc } from "@/workspace/blocks";
import { accentFor } from "@/design-system/tokens";
import { projectileLesson } from "@/data/lessons/projectile";
import { quadraticLesson } from "@/data/lessons/quadratic";
import { pythagoreanLesson } from "@/data/lessons/pythagorean";
import type { Depth } from "./types";

type Spec = { type: string; data: unknown; w: number; h: number };

function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUBJECTS: { subject: string; keywords: string[] }[] = [
  { subject: "Physics", keywords: ["ball", "gravity", "projectile", "motion", "newton", "force", "velocity", "physics", "energy"] },
  { subject: "Mathematics", keywords: ["quadratic", "equation", "algebra", "calculus", "integration", "derivative", "pythag", "triangle", "geometry", "math", "probability", "number"] },
  { subject: "Computer Science", keywords: ["code", "programming", "algorithm", "recursion", "function", "python", "javascript", "data structure", "computer", "software", "neural", "machine learning", "ai"] },
  { subject: "Biology", keywords: ["cell", "photosynthesis", "dna", "biology", "organism", "evolution", "gene", "plant", "respiration", "ecosystem"] },
  { subject: "Chemistry", keywords: ["molecule", "atom", "reaction", "chemistry", "bond", "acid", "element", "compound"] },
  { subject: "History", keywords: ["revolution", "war", "history", "empire", "ancient", "century", "king", "civilization", "dynasty"] },
  { subject: "Geography", keywords: ["map", "country", "geography", "continent", "river", "mountain", "climate", "capital", "ocean"] },
  { subject: "Economics", keywords: ["economics", "supply", "demand", "market", "inflation", "gdp", "trade", "money", "price"] },
];

function matchesWord(text: string, keyword: string): boolean {
  // whole-word match so "revolution" does not match "evolution"
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

export function classify(topic: string): string {
  const t = topic.toLowerCase();
  for (const s of SUBJECTS) if (s.keywords.some((k) => matchesWord(t, k))) return s.subject;
  return "General";
}

function header(topic: string, subject: string, depth: Depth): Spec[] {
  const intro =
    depth === "simpler"
      ? `Let's understand ${topic.toLowerCase()} in the simplest way possible.`
      : depth === "deeper"
      ? `A precise, deeper look at ${topic.toLowerCase()}.`
      : `Let's build a clear, complete picture of ${topic.toLowerCase()}.`;
  return [
    { type: "heading", data: { text: titleCase(topic), level: 1, accent: accentFor(subject) }, w: 760, h: 58 },
    { type: "text", data: { content: intro }, w: 640, h: 80 },
  ];
}

function bySubject(topic: string, subject: string, depth: Depth): Spec[] {
  const variant = depth === "deeper" ? "deeper" : depth === "simpler" ? "simpler" : "normal";
  const t = topic.toLowerCase();

  switch (subject) {
    case "Physics":
      return [
        { type: "sketch", data: { lesson: projectileLesson, variant }, w: 980, h: 700 },
        { type: "equation", data: { tex: "v = u + at", display: true }, w: 420, h: 70 },
        { type: "equation", data: { tex: "s = ut + \\tfrac{1}{2}at^2", display: true }, w: 460, h: 80 },
        {
          type: "chart",
          data: {
            kind: "line", xKey: "t", yKeys: ["velocity"],
            data: [{ t: "0", velocity: 20 }, { t: "1", velocity: 10 }, { t: "2", velocity: 0 }, { t: "3", velocity: -10 }, { t: "4", velocity: -20 }],
          }, w: 560, h: 290,
        },
      ];
    case "Mathematics": {
      const lesson = t.includes("pythag") || t.includes("triangle") ? pythagoreanLesson : quadraticLesson;
      return [
        { type: "sketch", data: { lesson, variant }, w: 980, h: 700 },
        { type: "equation", data: { tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", display: true }, w: 520, h: 90 },
        { type: "interactive-math", data: { kind: "parabola" }, w: 480, h: 340 },
      ];
    }
    case "Computer Science":
      return [
        {
          type: "code",
          data: {
            language: "python",
            code: "def solve(n):\n    if n <= 1:\n        return n\n    return solve(n - 1) + solve(n - 2)\n\nprint([solve(i) for i in range(8)])",
          }, w: 620, h: 300,
        },
        {
          type: "flow",
          data: {
            nodes: [{ id: "1", label: "Input", x: 0, y: 40 }, { id: "2", label: "Process", x: 210, y: 40 }, { id: "3", label: "Output", x: 430, y: 40 }],
            edges: [{ source: "1", target: "2" }, { source: "2", target: "3" }],
          }, w: 620, h: 320,
        },
        { type: "callout", data: { tone: "idea", title: "Key idea", body: "Break the problem into a base case and a smaller sub-problem." }, w: 520, h: 100 },
      ];
    case "Biology":
      return [
        { type: "mermaid", data: { code: "graph TD\n  A[Sunlight] --> C{Chloroplast}\n  W[Water] --> C\n  D[CO2] --> C\n  C --> G[Glucose]\n  C --> O[Oxygen]" }, w: 540, h: 260 },
        {
          type: "comparison",
          data: {
            title: "Photosynthesis vs Respiration",
            left: { head: "Photosynthesis", points: ["Needs light", "Takes CO₂", "Makes glucose"] },
            right: { head: "Respiration", points: ["No light", "Takes O₂", "Releases energy"] },
          }, w: 620, h: 190,
        },
        { type: "knowledge-graph", data: { nodes: [{ id: "a", label: "Cell" }, { id: "b", label: "Energy" }, { id: "c", label: "Growth" }], edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }] }, w: 620, h: 360 },
      ];
    case "Chemistry":
      return [
        { type: "molecule", data: { format: "xyz", data: projectileFreeMethane() }, w: 480, h: 340 },
        { type: "mermaid", data: { code: "graph LR\n  R1[Reactant A] --> P[Product]\n  R2[Reactant B] --> P" }, w: 480, h: 220 },
        {
          type: "table",
          data: {
            columns: [{ key: "el", label: "Element" }, { key: "sym", label: "Symbol" }, { key: "z", label: "Z" }],
            rows: [{ el: "Hydrogen", sym: "H", z: 1 }, { el: "Carbon", sym: "C", z: 6 }, { el: "Oxygen", sym: "O", z: 8 }],
          }, w: 520, h: 190,
        },
      ];
    case "History":
      return [
        {
          type: "timeline",
          data: {
            items: [
              { id: 1, content: "Beginning", start: "1789-05-05" },
              { id: 2, content: "Turning point", start: "1789-07-14" },
              { id: 3, content: "Consequence", start: "1793-01-21" },
              { id: 4, content: "Resolution", start: "1799-11-09" },
            ],
          }, w: 760, h: 320,
        },
        { type: "callout", data: { tone: "info", title: "Context", body: "Every event here reshaped what came after — trace the cause and effect." }, w: 560, h: 100 },
      ];
    case "Geography":
      return [
        { type: "map", data: { center: [0, 20], zoom: 2, markerLabel: titleCase(topic) }, w: 620, h: 340 },
        { type: "callout", data: { tone: "info", body: "Zoom and pan the map to explore the region." }, w: 520, h: 80 },
      ];
    case "Economics":
      return [
        {
          type: "chart",
          data: {
            kind: "line", xKey: "q", yKeys: ["supply", "demand"],
            data: [{ q: "1", supply: 2, demand: 10 }, { q: "2", supply: 4, demand: 8 }, { q: "3", supply: 6, demand: 6 }, { q: "4", supply: 8, demand: 4 }, { q: "5", supply: 10, demand: 2 }],
          }, w: 600, h: 290,
        },
        {
          type: "comparison",
          data: { title: "Supply vs Demand", left: { head: "Supply", points: ["Rises with price", "Producers"] }, right: { head: "Demand", points: ["Falls with price", "Consumers"] } },
          w: 600, h: 170,
        },
      ];
    default:
      return [
        { type: "mindmap", data: { markdown: `# ${titleCase(topic)}\n## Idea 1\n- detail\n## Idea 2\n- detail\n## Idea 3\n- detail` }, w: 620, h: 320 },
        { type: "callout", data: { tone: "idea", title: "Core idea", body: `${titleCase(topic)} makes sense once you connect it to what you already know.` }, w: 560, h: 100 },
      ];
  }
}

function footer(topic: string): Spec[] {
  return [
    { type: "definition", data: { term: titleCase(topic), definition: `A clear, working understanding of ${topic.toLowerCase()}.` }, w: 500, h: 130 },
    {
      type: "quiz",
      data: {
        question: `Ready to check your understanding of ${topic.toLowerCase()}?`,
        options: [{ id: "y", label: "Yes, quiz me" }, { id: "n", label: "Review once more" }],
        answerId: "y",
        explanation: "Great — retrieval practice is the fastest way to learn.",
      }, w: 520, h: 200,
    },
  ];
}

function projectileFreeMethane(): string {
  return `5
Methane
C  0.000  0.000  0.000
H  0.629  0.629  0.629
H -0.629 -0.629  0.629
H -0.629  0.629 -0.629
H  0.629 -0.629 -0.629`;
}

/** Stack specs vertically into positioned block instances. */
function stack(topic: string, specs: Spec[]): BlockInstance[] {
  let y = 40;
  const x = 80;
  return specs.map((s, i) => {
    const block: BlockInstance = {
      id: `${s.type}-${i}`,
      type: s.type,
      layout: { x, y, w: s.w, h: s.h },
      data: s.data,
    };
    y += s.h + 40;
    return block;
  });
}

export function buildWorkspace(topic: string, depth: Depth = "normal"): WorkspaceDoc {
  const clean = topic.trim() || "this idea";
  const subject = classify(clean);
  const specs = [...header(clean, subject, depth), ...bySubject(clean, subject, depth), ...footer(clean)];
  return { id: `ws-${clean.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, topic: clean, subject, blocks: stack(clean, specs) };
}
