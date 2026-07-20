import type { PlannedBlock, TeachRequest } from "@/features/workspace/ai/types";
import {
  headingData,
  subheadingData,
  textData,
  admonitionData,
  formulaData,
  barChartData,
  diagramData,
} from "@/features/workspace/ai/mock/content";

/**
 * The mock "teacher". Turns a request into an ordered plan of REAL blocks. This
 * stands in for the Phase-6 backend: subject-agnostic templates, with a little
 * extra fidelity for the three authored topics. Content is structural, not
 * genuinely intelligent — Phase 5 proves the experience, Phase 6 the substance.
 */

const H = { heading: 60, sub: 46, para: 104, callout: 122, summary: 118, formula: 92, chart: 300, diagram: 280, caption: 40 };

type Kind = "projectile" | "quadratic" | "pythagoras" | "generic";

function classify(topic: string): Kind {
  const t = topic.toLowerCase();
  if (/pythag|hypotenuse|right triangle/.test(t)) return "pythagoras";
  if (/quadratic|parabola|roots|x\^?2|discriminant/.test(t)) return "quadratic";
  if (/projectile|gravity|thrown|falling|newton/.test(t)) return "projectile";
  return "generic";
}

const b = (type: string, data: unknown, height: number, streamText?: string): PlannedBlock => ({ type, data, height, streamText });

/** A fresh lesson for a topic. */
export function planLesson(topic: string): PlannedBlock[] {
  const t = topic.trim() || "this idea";
  const kind = classify(t);

  const intro = `Let's build a clear picture of ${t.toLowerCase()}. We'll start from one simple idea and grow it, step by step, until the whole thing makes sense.`;
  const detail = `The trick is to hold onto the core idea and watch how everything else follows from it. Once you can see it, ${t.toLowerCase()} stops being something to memorise and becomes something you understand.`;

  const plan: PlannedBlock[] = [
    b("heading", headingData(t), H.heading),
    b("paragraph", textData(""), H.para, intro),
    b("subheading", subheadingData("The core idea"), H.sub),
    b("callout", admonitionData(`${t}: the one idea everything is built on.`), H.callout),
    b("paragraph", textData(""), H.para, detail),
  ];

  if (kind === "pythagoras") {
    plan.push(b("formula", formulaData("a^2 + b^2 = c^2"), H.formula));
    plan.push(
      b("basic-diagram", diagramData(
        [
          { id: "n1", x: 40, y: 150, label: "a" },
          { id: "n2", x: 40, y: 40, label: "c" },
          { id: "n3", x: 240, y: 150, label: "b" },
        ],
        [
          { id: "e1", from: "n1", to: "n2" },
          { id: "e2", from: "n2", to: "n3" },
          { id: "e3", from: "n3", to: "n1" },
        ]
      ), H.diagram)
    );
  } else if (kind === "quadratic") {
    plan.push(b("formula", formulaData("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"), H.formula));
    plan.push(b("chart", barChartData([
      { label: "-2", value: 4 }, { label: "-1", value: 1 }, { label: "0", value: 0 }, { label: "1", value: 1 }, { label: "2", value: 4 },
    ]), H.chart));
  } else if (kind === "projectile") {
    plan.push(b("formula", formulaData("y = v_0 t - \\tfrac{1}{2} g t^2"), H.formula));
  } else {
    plan.push(b("chart", barChartData([
      { label: "A", value: 6 }, { label: "B", value: 11 }, { label: "C", value: 5 }, { label: "D", value: 9 },
    ]), H.chart));
  }

  plan.push(b("summary", admonitionData(`In short: ${t.toLowerCase()} comes down to that one idea — everything else is just seeing it from a new angle.`), H.summary));
  return plan;
}

/** A follow-up explanation for a command or question. Always a NEW region. */
export function planCommand(req: TeachRequest): PlannedBlock[] {
  const topic = req.topic.trim() || "this idea";
  const cmd = req.command ?? "";
  const q = req.text?.trim();

  if (req.kind === "question" && q) {
    return [
      b("heading", headingData(q), H.heading),
      b("paragraph", textData(""), H.para, `Good question. Here's how ${q.toLowerCase().replace(/\?+$/, "")} connects back to ${topic.toLowerCase()} — and why it matters.`),
      b("summary", admonitionData("The short answer, kept simple so it sticks."), H.summary),
    ];
  }

  switch (cmd) {
    case "simpler":
      return [
        b("heading", headingData("In simpler terms"), H.heading),
        b("paragraph", textData(""), H.para, `Forget the details for a moment. At its heart, ${topic.toLowerCase()} is just this one plain idea, said in everyday words.`),
        b("tip", admonitionData("If you remember only one sentence, remember this one."), H.callout),
      ];
    case "harder":
      return [
        b("heading", headingData("Going deeper"), H.heading),
        b("paragraph", textData(""), H.para, `Now that the idea is solid, let's push on it and see where the edges are.`),
        b("formula", formulaData("f(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}"), H.formula),
        b("summary", admonitionData("The deeper view — same idea, sharper tools."), H.summary),
      ];
    case "example":
      return [
        b("heading", headingData("Another example"), H.heading),
        b("paragraph", textData(""), H.para, `Here's the same idea in a different situation, so you can see it isn't a one-off.`),
        b("chart", barChartData([{ label: "1", value: 3 }, { label: "2", value: 7 }, { label: "3", value: 12 }, { label: "4", value: 8 }]), H.chart),
      ];
    case "visual":
      return [
        b("heading", headingData("Seen visually"), H.heading),
        b("basic-diagram", diagramData(
          [{ id: "a", x: 30, y: 60, label: "Idea" }, { id: "b", x: 220, y: 60, label: "Result" }, { id: "c", x: 130, y: 170, label: "Why" }],
          [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "a", to: "c" }]
        ), H.diagram),
        b("caption", textData("The idea, drawn out."), H.caption),
      ];
    case "again":
      return [
        b("heading", headingData("Another way to see it"), H.heading),
        b("paragraph", textData(""), H.para, `Same idea, a fresh angle. Sometimes it clicks the second time, told differently.`),
        b("callout", admonitionData(`${topic}: reframed.`), H.callout),
      ];
    case "continue":
      return [
        b("subheading", subheadingData("Continuing…"), H.sub),
        b("paragraph", textData(""), H.para, `Picking up right where we left off, the next piece follows naturally.`),
        b("summary", admonitionData("One more step forward."), H.summary),
      ];
    default: {
      // why / how / what if
      const label = cmd === "why" ? "Why it works" : cmd === "how" ? "How it works" : cmd === "whatif" ? "What if we change it?" : "More on this";
      return [
        b("heading", headingData(label), H.heading),
        b("paragraph", textData(""), H.para, `${label} — traced back to the core idea of ${topic.toLowerCase()}.`),
        b("summary", admonitionData("The gist, in one line."), H.summary),
      ];
    }
  }
}

/** Region title for a request. */
export function titleFor(req: TeachRequest): string {
  if (req.kind === "lesson") return req.topic.trim() || "Lesson";
  if (req.kind === "question" && req.text) return req.text.trim();
  const map: Record<string, string> = {
    simpler: "Simpler", harder: "Deeper", example: "Another example", visual: "Visual",
    again: "Another way", continue: "Continued", why: "Why", how: "How", whatif: "What if",
  };
  return map[req.command ?? ""] ?? "Explanation";
}
