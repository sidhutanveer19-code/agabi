/**
 * PDF-text → normalized markdown (A-4). Deterministic, pure — reconstructs document structure from
 * the raw text pdf-parse emits so the existing markdown pipeline (discovery + chunk) sees headings.
 * Heuristics tuned for NCERT-style numbering ("8.1 Introduction", "8.2.1 …") + a caps chapter title.
 *
 * NDND (R1, never silently skip). Nothing is removed or rewritten without a record: every dropped
 * line is returned in `drops` with its 1-based source line number, the rule that matched, and the
 * text; every repaired line is returned in `repairs` with before/after. `droppedNoiseLines` is kept
 * as the count so existing callers keep working, but the count is now the *summary* of the record,
 * not the whole story.
 */

const SECTION = /^(\d+\.\d+)(\.\d+)*\s+(\S.*)$/; // 8.1 / 8.2.1 …

/** Noise rules, in match order. `id` is what lands in the drop record. */
const NOISE_RULES: { id: string; re: RegExp }[] = [
  { id: "page-number", re: /^\s*\d{1,4}\s*$/ }, // a standalone page number
  { id: "page-marker", re: /^\s*--\s*\d{1,4}\s+of\s+\d{1,4}\s*--\s*$/ }, // "-- 3 of 9 --" (pdf-parse page break)
  { id: "running-header", re: /^[A-Z][A-Z\s]{5,}\d{1,4}\s*$/ }, // "MATHEMATICS 114"
  { id: "running-header", re: /^\d{1,4}\s+[A-Z][A-Z\s]{5,}$/ }, // "188 MATHEMATICS" (left pages)
];

export interface DroppedLine {
  line: number; // 1-based line number in the input text
  rule: string;
  text: string;
}

export interface RepairedLine {
  line: number; // 1-based line number in the input text
  rule: string;
  before: string;
  after: string;
}

export interface MarkdownResult {
  markdown: string;
  headings: number;
  droppedNoiseLines: number; // count of `drops` — kept for existing callers
  drops: DroppedLine[]; // EVERY dropped line, with reason (R1)
  repairs: RepairedLine[]; // EVERY rewritten line, with before/after (R1)
}

/**
 * Collapse "faux-bold" repetition. Some NCERT PDFs draw a heading several times with small offsets;
 * pdf-parse then emits `NOTES FOR THE TEACHER NOTES FOR THE TEACHER NOTES FOR THE TEACHER …`, and
 * because such a heading is merged into the following paragraph it corrupts real body text (measured:
 * 396 runs across 23 of 67 chapters, 45k of 47k chars in the worst file).
 *
 * Longest-run-first: an n-token group repeated immediately is collapsed to one copy. Multi-token
 * groups need 2 repeats; single tokens need 3. Every collapse requires the group to contain a word
 * of ≥3 letters, so numeric sequences ("0 0 0 0" in a table) and short words are never touched.
 */
const HAS_WORD = /[A-Za-z]{3,}/;

export function collapseRepeats(line: string): string {
  let s = line;
  for (let n = 8; n >= 2; n--) {
    const group = `(?:\\S+(?:\\s+\\S+){${n - 1}})`;
    s = s.replace(new RegExp(`\\b(${group})(?:\\s+\\1\\b)+`, "g"), (whole, g: string) => (HAS_WORD.test(g) ? g : whole));
  }
  s = s.replace(/\b([A-Za-z]{3,})(?:\s+\1\b){2,}/g, "$1");
  return s;
}

export function pdfTextToMarkdown(text: string, chapterTitle?: string): MarkdownResult {
  const out: string[] = [];
  const drops: DroppedLine[] = [];
  const repairs: RepairedLine[] = [];
  let headings = 0;
  let titleEmitted = false;

  if (chapterTitle) {
    out.push(`# ${chapterTitle.trim()}`, "");
    titleEmitted = true;
  }

  const lines = text.split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(para.join(" ").replace(/\s+/g, " ").trim(), "");
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, " ").trimEnd();
    const t = line.trim();
    if (t === "") { flush(); continue; }

    const noise = NOISE_RULES.find((r) => r.re.test(t));
    if (noise) { drops.push({ line: i + 1, rule: noise.id, text: t }); continue; }

    // First ALL-CAPS title line becomes the H1 if no explicit title was given.
    if (!titleEmitted && /^[A-Z][A-Z\s,'-]{5,}$/.test(t) && t.split(" ").length <= 8) {
      flush();
      out.push(`# ${t.replace(/\s{2,}/g, " ").trim()}`, "");
      titleEmitted = true;
      continue;
    }

    const m = SECTION.exec(t);
    if (m) {
      flush();
      const depth = (m[1].match(/\./g)?.length ?? 1) + (m[2] ? m[2].split(".").length - 1 : 0);
      const hashes = "#".repeat(Math.min(depth + 1, 4)); // 8.1 → ## , 8.2.1 → ###
      out.push(`${hashes} ${m[1]}${m[2] ?? ""} ${m[3].trim()}`, "");
      headings++;
      continue;
    }

    const repaired = collapseRepeats(t);
    if (repaired !== t) repairs.push({ line: i + 1, rule: "faux-bold-repeat", before: t, after: repaired });
    para.push(repaired);
  }
  flush();

  return {
    markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
    headings,
    droppedNoiseLines: drops.length,
    drops,
    repairs,
  };
}
