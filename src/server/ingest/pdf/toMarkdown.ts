/**
 * PDF-text → normalized markdown (A-4). Deterministic, pure — reconstructs document structure from
 * the raw text pdf-parse emits so the existing markdown pipeline (discovery + chunk) sees headings.
 * Heuristics tuned for NCERT-style numbering ("8.1 Introduction", "8.2.1 …") + a caps chapter title.
 * NDND: no meaningful line is dropped except page-number/running-header noise (reported by the caller).
 */

const SECTION = /^(\d+\.\d+)(\.\d+)*\s+(\S.*)$/; // 8.1 / 8.2.1 …
const PAGE_NOISE = /^\s*\d{1,4}\s*$/; // a standalone page number
const RUNNING_HEADER = /^[A-Z][A-Z\s]{6,}\d{1,4}\s*$/; // "MATHEMATICS 114" style footer/header

export interface MarkdownResult {
  markdown: string;
  headings: number;
  droppedNoiseLines: number; // page numbers / running headers removed (reported, NDND)
}

export function pdfTextToMarkdown(text: string, chapterTitle?: string): MarkdownResult {
  const out: string[] = [];
  let headings = 0;
  let dropped = 0;
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

  for (const raw of lines) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    const t = line.trim();
    if (t === "") { flush(); continue; }
    if (PAGE_NOISE.test(t) || RUNNING_HEADER.test(t)) { dropped++; continue; }

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
    para.push(t);
  }
  flush();

  return { markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", headings, droppedNoiseLines: dropped };
}
