import { VISUAL_ONLY_TYPES, TEXT_ONLY_TYPES, BLOCK_TYPE_SET } from "@/server/conversation/blockTypes";

export interface OutlineSlot {
  slot: number;
  type: string;
  intent: string; // what this slot should teach, one short phrase
}

export interface RepairChange { slot: number; from: string; to: string; reason: string }
export interface RepairResult { outline: OutlineSlot[]; changes: RepairChange[]; source: "model" | "default" }

const VISUAL_SET = new Set<string>(VISUAL_ONLY_TYPES);
const TEXT_SET = new Set<string>(TEXT_ONLY_TYPES);

export const isVisual = (t: string) => VISUAL_SET.has(t);
export const isText = (t: string) => TEXT_SET.has(t);

/** mindmap takes plain markdown — any model can fill one, for any topic. */
export const FALLBACK_VISUAL = "mindmap";

/** intent phrase -> the visual that fits its SHAPE (not its subject). */
const RULES: Array<{ test: RegExp; type: string }> = [
  { test: /\b(step|steps|process|cycle|stage|procedure|method|sequence|how it works)\b/i, type: "flow" },
  { test: /\b(compare|comparison|versus|vs\.?|difference|differ|contrast)\b/i,            type: "table" },
  { test: /\b(\d{3,4}\s?(ad|bc|ce|bce)\b|1\d{3}\b|20\d{2}\b|century|chronolog|timeline|movement|revolution|revolt|dynasty)\b/i, type: "timeline" },
  { test: /\b(data|growth|percentage|percent|trend|statistic|distribution|rate)\b/i,      type: "chart" },
  { test: /\b(formulas?|formulae|equations?|derive|law of|identity|expression)\b/i,        type: "formula" },
  { test: /\b(triangle|angle|circle|polygon|geometry|construct|bisect)\b/i,               type: "geometry" },
  { test: /\b(graph|plot|curve|parabola|function of x)\b/i,                               type: "graph" },
  { test: /\b(place|region|country|state|city|map|located|geograph|river|climate)\b/i,    type: "map" },
  { test: /\b(molecule|compound|bond|atom|chemical structure)\b/i,                        type: "molecule" },
  { test: /\b(types|kinds|parts|branches|categories|classif|components|structure of)\b/i, type: "mindmap" },
];

export function pickVisualFor(intent: string): string {
  for (const r of RULES) if (r.test.test(intent)) return r.type;
  return FALLBACK_VISUAL;
}

/**
 * Deterministic subject classification from a topic string — same shape of problem
 * as pickVisualFor, same style, NO model call (the stakes are a sidebar dot colour).
 * Every returned value MUST be a real key in `subjectAccent` (src/config/tokens.ts);
 * accentFor() falls back to General for anything unrecognised, so a miss degrades to
 * a violet dot, never an error. Asserted in subject.test.ts.
 */
// Leading `\b` only (no trailing boundary): the terms are deliberately truncated
// STEMS ("molecul", "agricultur", "acid") meant to match inflections ("molecular",
// "acids"). A trailing `\b` would defeat that (and fail the verify cases).
const SUBJECT_RULES: Array<{ test: RegExp; subject: string }> = [
  { test: /\b(algebra|quadratic|trigonometr|geometr|calculus|polynomial|arithmetic|theorem|equation|probability|statistic)/i, subject: "Mathematics" },
  { test: /\b(force|motion|newton|velocity|momentum|optics|refraction|electricity|circuit|magnet|thermodynamic|wave|gravit)/i, subject: "Physics" },
  { test: /\b(acid|base|salt|periodic table|reaction|molecul|compound|element|bond|oxidation|carbon|metal)/i, subject: "Chemistry" },
  { test: /\b(cell|photosynthesis|respiration|digest|heredity|evolution|organ|tissue|nutrition|reproduc|ecosystem)/i, subject: "Biology" },
  { test: /\b(war|revolt|revolution|dynasty|empire|nationalis|colonial|independence|movement|treaty|1\d{3})/i, subject: "History" },
  { test: /\b(resource|climate|monsoon|river|soil|agricultur|mineral|population|map|terrain|region)/i, subject: "Geography" },
  { test: /\b(poem|prose|grammar|essay|literature|character|narrat|tense|comprehension|chapter)/i, subject: "English" },
  { test: /\b(democracy|constitution|parliament|federalis|judiciar|rights|citizen)/i, subject: "Law" },
  { test: /\b(economy|economic|market|demand|supply|gdp|sector|trade|money|bank)/i, subject: "Economics" },
  { test: /\b(algorithm|programming|computer|software|data structure|code)/i, subject: "Computer Science" },
];

export function classifySubject(topic: string): string {
  for (const r of SUBJECT_RULES) if (r.test.test(topic)) return r.subject;
  return "General";
}

export const countVisuals = (o: OutlineSlot[]) => o.filter((s) => isVisual(s.type)).length;

/** A slot we may convert: not the opening heading, not the closing summary. */
const convertible = (o: OutlineSlot[], i: number) =>
  i > 0 && i < o.length - 1 && !isVisual(o[i].type);

/** Middle index of the longest run of convertible text slots. -1 if none. */
function longestTextRunMiddle(o: OutlineSlot[]): number {
  let bestStart = -1, bestLen = 0, start = -1, len = 0;
  for (let i = 0; i < o.length; i++) {
    if (convertible(o, i)) {
      if (start === -1) start = i;
      len++;
      if (len > bestLen) { bestLen = len; bestStart = start; }
    } else { start = -1; len = 0; }
  }
  return bestLen === 0 ? -1 : bestStart + Math.floor((bestLen - 1) / 2);
}

/** Used when the model's outline call fails entirely. Always visual-rich, and
 *  varied by topic (a history topic gets a timeline, a maths topic a formula) so
 *  failed lessons don't all look identical. Still deterministic per topic. */
export function defaultOutline(topic: string): OutlineSlot[] {
  const primary = pickVisualFor(topic);
  const secondary = primary === "table" ? "mindmap" : "table";
  const tertiary = primary === "flow" ? "chart" : "flow";
  return [
    { slot: 1, type: "heading",   intent: topic },
    { slot: 2, type: "paragraph", intent: `what ${topic} is and why it matters` },
    { slot: 3, type: primary,     intent: `the core structure of ${topic}` },
    { slot: 4, type: "paragraph", intent: `explain the main idea of ${topic}` },
    { slot: 5, type: secondary,   intent: `the key cases or parts of ${topic}` },
    { slot: 6, type: "paragraph", intent: `a worked example of ${topic}` },
    { slot: 7, type: tertiary,    intent: `how ${topic} works step by step` },
    { slot: 8, type: "callout",   intent: `the one thing to remember about ${topic}` },
    { slot: 9, type: "summary",   intent: `recap of ${topic}` },
  ];
}

/**
 * THE GUARANTEE.
 * Takes whatever the model proposed and returns a shape that ALWAYS satisfies:
 *   - slot 1 is a heading, last slot is exactly one summary
 *   - at least `minVisuals` visual blocks
 *   - never more than `maxTextRun` text blocks in a row
 * Pure code. No model call. Deterministic.
 */
export function repairOutline(
  raw: OutlineSlot[],
  topic: string,
  opts: { minVisuals?: number; maxSlots?: number; maxTextRun?: number } = {},
): RepairResult {
  const minVisuals = opts.minVisuals ?? 3;
  const maxSlots   = opts.maxSlots   ?? 10;
  const maxTextRun = opts.maxTextRun ?? 2;
  const changes: RepairChange[] = [];

  // 1. drop unknown types, clamp length, renumber
  const out: OutlineSlot[] = (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s.type === "string" && BLOCK_TYPE_SET.has(s.type))
    .slice(0, maxSlots)
    .map((s, i) => ({ slot: i + 1, type: s.type, intent: String(s.intent ?? topic).slice(0, 200) }));

  // 2. too short to hold the visual floor -> known-good default.
  //    3 visuals need 3 interior slots + heading/summary bookends = 5 minimum;
  //    a 4-slot outline can only fit 2 visuals, so it cannot honor the guarantee.
  if (out.length < 5) {
    return { outline: defaultOutline(topic), changes: [], source: "default" };
  }

  // 3. force the bookends
  if (out[0].type !== "heading") {
    changes.push({ slot: 1, from: out[0].type, to: "heading", reason: "first slot must be a heading" });
    out[0] = { ...out[0], type: "heading" };
  }
  const li = out.length - 1;
  if (out[li].type !== "summary") {
    changes.push({ slot: li + 1, from: out[li].type, to: "summary", reason: "last slot must be a summary" });
    out[li] = { ...out[li], type: "summary" };
  }
  // exactly one summary — demote any earlier ones
  for (let i = 0; i < li; i++) {
    if (out[i].type === "summary") {
      changes.push({ slot: out[i].slot, from: "summary", to: "paragraph", reason: "only one summary allowed" });
      out[i] = { ...out[i], type: "paragraph" };
    }
  }

  // 4. break long prose runs
  let run = 0;
  for (let i = 0; i < out.length; i++) {
    if (isVisual(out[i].type)) { run = 0; continue; }
    run++;
    if (run > maxTextRun && convertible(out, i)) {
      const from = out[i].type;
      const to = pickVisualFor(out[i].intent);
      out[i] = { ...out[i], type: to };
      changes.push({ slot: out[i].slot, from, to, reason: `more than ${maxTextRun} text blocks in a row` });
      run = 0;
    }
  }

  // 5. top up until the visual floor is met
  let guard = 0;
  while (countVisuals(out) < minVisuals && guard++ < maxSlots) {
    const idx = longestTextRunMiddle(out);
    if (idx === -1) break; // only bookends left; nothing safe to convert
    const from = out[idx].type;
    const to = pickVisualFor(out[idx].intent);
    out[idx] = { ...out[idx], type: to };
    changes.push({ slot: out[idx].slot, from, to, reason: `below ${minVisuals} visuals` });
  }

  return { outline: out, changes, source: "model" };
}
