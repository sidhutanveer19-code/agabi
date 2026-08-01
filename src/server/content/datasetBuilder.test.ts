import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * buildDatasetFromPdfs + ncertMapper — the Phase-C dataset packager.
 *
 * The ONLY faked edges are (a) the binary PDF parser `extractPdfText` (real I/O — it
 * decodes bytes; here the "bytes" are a JSON envelope {text,pages} so each fake source
 * fully drives the REAL pdfTextToMarkdown), and (b) the clock (`new Date().toISOString()`
 * in build-report). Everything else runs for real: real filesystem (a disposable temp
 * dir per test — mkdir/readdir/read/write on disk), the real markdown pipeline, the real
 * `sha256`/`slugify`, and the real `DatasetManifestSchema.parse` (which rejects an empty
 * `sources`). Every assertion names the EXACT on-disk result — chapter markdown byte for
 * byte, the parsed manifest.json, the parsed build-report.json, and the return value.
 *
 * Branches under test (datasetBuilder.ts):
 *   - readdirSync .filter(/\.pdf$/i)  → a non-pdf file is ignored entirely
 *   - .sort()                         → sources come out in sorted order (a before b)
 *   - if (!meta) skip                 → mapper→null pushes a `skipped` record, extract NOT called
 *   - opts.tier present vs undefined  → source.tier emitted vs omitted
 *   - opts.profile ?? "generic"       → explicit profile kept vs defaulted to "generic"
 *   - opts.attribution present vs absent
 *   - sources empty → DatasetManifestSchema.parse THROWS (min 1), no manifest written
 *   - the noiseDropped / repairsMade / totalChars accumulators over multiple sources
 * ncertMapper: answer-key→null (and it precedes the digit branch), digit→Mathematics,
 *   English, Sci, Science, Hist/SocSci/Geo/Eco/Pol→Social Science, case-insensitive
 *   `.pdf`/`.PDF` strip, and the no-match→null default.
 */

// Fake ONLY the binary PDF parser. The fake "pdf bytes" are a JSON {text,pages} envelope,
// so each source's real text flows through the REAL markdown pipeline. Faking this factory
// also stops the real module (and its `pdf-parse` dependency) from ever loading.
vi.mock("@/server/ingest/pdf/extractText", () => ({
  extractPdfText: vi.fn(async (bytes: Uint8Array): Promise<{ text: string; pages: number }> => {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as { text: string; pages: number };
    return { text: parsed.text, pages: parsed.pages };
  }),
}));

import { buildDatasetFromPdfs, ncertMapper, type BuildOptions, type MetaMapper } from "@/server/content/datasetBuilder";
import { extractPdfText } from "@/server/ingest/pdf/extractText";

const extractSpy = extractPdfText as unknown as ReturnType<typeof vi.fn>;

// --- Real fixtures, with the EXACT outputs the real pipeline produces (verified) ---
const TEXT_A = "8.1 Introduction\nSome intro sentence.\nMATHEMATICS 114\n8.2.1 Deep Dive\nhello hello hello world\n114";
const TEXT_B = "Just a plain paragraph about light.";
const MD_A = "# Real Numbers\n\n## 8.1 Introduction\n\nSome intro sentence.\n\n### 8.2.1 Deep Dive\n\nhello world\n";
const MD_B = "# Light\n\nJust a plain paragraph about light.\n";
const HASH_A = "c621bb90983511aa"; // sha256(MD_A).slice(0,16)
const HASH_B = "0f9ab033d87867af"; // sha256(MD_B).slice(0,16)
const DROPS_A = [
  { line: 3, rule: "running-header", text: "MATHEMATICS 114" },
  { line: 6, rule: "page-number", text: "114" },
];
const REPAIRS_A = [{ line: 5, rule: "faux-bold-repeat", before: "hello hello hello world", after: "hello world" }];
const SKIP_REASON = "mapper returned null (not a chapter — answer key or unrecognised filename)";
const FIXED_ISO = "2026-07-27T12:00:00.000Z";

const tmpRoots: string[] = [];
function freshRoot(): { pdfDir: string; outDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "agabi-dsb-"));
  tmpRoots.push(root);
  const pdfDir = join(root, "pdfs");
  const outDir = join(root, "out");
  mkdirSync(pdfDir, { recursive: true });
  return { pdfDir, outDir, root };
}
function writeFakePdf(dir: string, name: string, text: string, pages: number): void {
  writeFileSync(join(dir, name), JSON.stringify({ text, pages }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// mapper used by the multi-source build: real subjects/chapters for a/b, null for anything else.
const buildMapper: MetaMapper = (file) => {
  if (file === "a.pdf") return { subject: "Mathematics", chapter: "Real Numbers" };
  if (file === "b.pdf") return { subject: "Science", chapter: "Light" };
  return null;
};

describe("buildDatasetFromPdfs — full multi-source build", () => {
  it("filters non-pdf, sorts, skips mapper-null, writes exact chapters/manifest/build-report + return", async () => {
    const { pdfDir, outDir } = freshRoot();
    // Written out of sorted order; a non-pdf and a skipped file are both present.
    writeFakePdf(pdfDir, "b.pdf", TEXT_B, 3);
    writeFakePdf(pdfDir, "a.pdf", TEXT_A, 12);
    // If the skip branch ever failed and this got parsed by extract, JSON.parse throws → test explodes (intended).
    writeFileSync(join(pdfDir, "skipme.pdf"), "SHOULD-NOT-BE-READ");
    writeFileSync(join(pdfDir, "notes.txt"), "not a pdf at all");

    const opts: BuildOptions = {
      id: "cbse-10-math-sci",
      name: "CBSE Class 10",
      profile: "cbse-10",
      license: "CC BY 4.0",
      version: "1.0.0",
      tier: "OFFICIAL_TEXTBOOK",
      attribution: { author: "NCERT", sourceUrl: "https://ncert.nic.in", retrievalDate: "2025-01-01" },
      mapper: buildMapper,
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_ISO));
    const res = await buildDatasetFromPdfs(pdfDir, outDir, opts);
    vi.useRealTimers();

    const recordA = { file: "a.pdf", ref: "chapters/mathematics-real-numbers.md", pages: 12, chars: MD_A.length, headings: 2, drops: DROPS_A, repairs: REPAIRS_A };
    const recordB = { file: "b.pdf", ref: "chapters/science-light.md", pages: 3, chars: MD_B.length, headings: 0, drops: [], repairs: [] };

    // 1) Return value — exact.
    expect(res).toEqual({
      outDir,
      chapters: 2,
      skipped: [{ file: "skipme.pdf", reason: SKIP_REASON }],
      totalChars: TEXT_A.length + TEXT_B.length, // 97 + 35 = 132
      noiseDropped: 2,
      repairsMade: 1,
      records: [recordA, recordB], // sorted: a before b
    });

    // 2) The skipped file (and the .txt) never reached the parser.
    expect(extractSpy).toHaveBeenCalledTimes(2);

    // 3) Chapter markdown on disk — byte for byte, proving the chapter title + text wiring.
    expect(readFileSync(join(outDir, "chapters/mathematics-real-numbers.md"), "utf8")).toBe(MD_A);
    expect(readFileSync(join(outDir, "chapters/science-light.md"), "utf8")).toBe(MD_B);

    // 4) manifest.json — exact, tier + attribution present, hashes are sha256(markdown).slice(0,16).
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      id: "cbse-10-math-sci",
      name: "CBSE Class 10",
      profile: "cbse-10",
      license: "CC BY 4.0",
      version: "1.0.0",
      attribution: { author: "NCERT", sourceUrl: "https://ncert.nic.in", retrievalDate: "2025-01-01" },
      sources: [
        { ref: "chapters/mathematics-real-numbers.md", format: "markdown", subject: "Mathematics", chapter: "Real Numbers", tier: "OFFICIAL_TEXTBOOK", hash: HASH_A },
        { ref: "chapters/science-light.md", format: "markdown", subject: "Science", chapter: "Light", tier: "OFFICIAL_TEXTBOOK", hash: HASH_B },
      ],
    });

    // 5) build-report.json — exact, builtAt from the faked clock, full R1 omission records shipped.
    const report = JSON.parse(readFileSync(join(outDir, "build-report.json"), "utf8"));
    expect(report).toEqual({
      builtAt: FIXED_ISO,
      chapters: 2,
      skipped: [{ file: "skipme.pdf", reason: SKIP_REASON }],
      totalChars: TEXT_A.length + TEXT_B.length,
      noiseDropped: 2,
      repairsMade: 1,
      records: [recordA, recordB],
    });
  });
});

describe("buildDatasetFromPdfs — defaults: no profile / tier / attribution", () => {
  it("profile falls back to 'generic', source omits tier, manifest omits attribution", async () => {
    const { pdfDir, outDir } = freshRoot();
    writeFakePdf(pdfDir, "only.pdf", TEXT_B, 5);
    const opts: BuildOptions = {
      id: "x",
      name: "X",
      license: "CC0-1.0",
      version: "1",
      mapper: () => ({ subject: "Science", chapter: "Light" }),
    };

    const res = await buildDatasetFromPdfs(pdfDir, outDir, opts);

    expect(res.chapters).toBe(1);
    expect(res.skipped).toEqual([]);
    expect(res.totalChars).toBe(TEXT_B.length);
    expect(res.noiseDropped).toBe(0);
    expect(res.repairsMade).toBe(0);
    expect(res.records).toEqual([
      { file: "only.pdf", ref: "chapters/science-light.md", pages: 5, chars: MD_B.length, headings: 0, drops: [], repairs: [] },
    ]);

    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest.profile).toBe("generic"); // opts.profile ?? "generic" → the default branch
    expect("attribution" in manifest).toBe(false); // optional, omitted
    // undefined tier is dropped by JSON.stringify → the source has NO tier key.
    expect(manifest.sources[0]).toEqual({
      ref: "chapters/science-light.md",
      format: "markdown",
      subject: "Science",
      chapter: "Light",
      hash: HASH_B,
    });
    expect("tier" in manifest.sources[0]).toBe(false);
  });
});

describe("buildDatasetFromPdfs — empty sources is a hard failure (R1: never a silent empty package)", () => {
  it("every file skipped → DatasetManifestSchema.parse rejects (sources min 1), no manifest/report written", async () => {
    const { pdfDir, outDir } = freshRoot();
    writeFakePdf(pdfDir, "answers.pdf", "irrelevant", 1); // mapper→null
    writeFileSync(join(pdfDir, "readme.md"), "ignored non-pdf");
    const opts: BuildOptions = { id: "e", name: "E", license: "CC0", version: "1", mapper: () => null };

    await expect(buildDatasetFromPdfs(pdfDir, outDir, opts)).rejects.toThrow();

    // Parser never ran (all skipped), and NO partial package was written.
    expect(extractSpy).not.toHaveBeenCalled();
    expect(existsSync(join(outDir, "manifest.json"))).toBe(false);
    expect(existsSync(join(outDir, "build-report.json"))).toBe(false);
    // mkdirSync ran before the loop, so the chapters dir exists even though the build aborted.
    expect(existsSync(join(outDir, "chapters"))).toBe(true);
  });
});

describe("ncertMapper — NCERT filename → {subject, chapter} | null", () => {
  it("answer keys → null, and the answer check precedes the digit-prefix branch", () => {
    expect(ncertMapper("3-Polynomials-Answers.pdf")).toBeNull(); // digit-prefixed, but an answer key first
    expect(ncertMapper("Science-Answers.pdf")).toBeNull();
    expect(ncertMapper("Math-Answer.pdf")).toBeNull(); // singular "Answer" (s?)
  });

  it("leading-digit filenames → Mathematics, with hyphens→spaces + trim, case-insensitive .PDF strip", () => {
    expect(ncertMapper("8-Quadratic-Equations.pdf")).toEqual({ subject: "Mathematics", chapter: "Quadratic Equations" });
    expect(ncertMapper("5-Circles.PDF")).toEqual({ subject: "Mathematics", chapter: "Circles" });
  });

  it("English prefix → English", () => {
    expect(ncertMapper("English-A-Letter-to-God.pdf")).toEqual({ subject: "English", chapter: "A Letter to God" });
    expect(ncertMapper("english-poem.pdf")).toEqual({ subject: "English", chapter: "poem" }); // case-insensitive
  });

  it("Sci / Science prefixes → Science", () => {
    expect(ncertMapper("Sci-Chemical-Reactions.pdf")).toEqual({ subject: "Science", chapter: "Chemical Reactions" });
    expect(ncertMapper("Science-Light.pdf")).toEqual({ subject: "Science", chapter: "Light" });
  });

  it("SocSci / Hist / Geo / Eco / Pol prefixes → Social Science (incl. underscore separator)", () => {
    expect(ncertMapper("SocSci-Federalism.pdf")).toEqual({ subject: "Social Science", chapter: "Federalism" });
    expect(ncertMapper("Hist_The-Rise-of-Nationalism.pdf")).toEqual({ subject: "Social Science", chapter: "The Rise of Nationalism" });
    expect(ncertMapper("Geo-Resources.pdf")).toEqual({ subject: "Social Science", chapter: "Resources" });
    expect(ncertMapper("Eco-Money.pdf")).toEqual({ subject: "Social Science", chapter: "Money" });
    expect(ncertMapper("Pol-Democracy.pdf")).toEqual({ subject: "Social Science", chapter: "Democracy" });
  });

  it("unrecognised filename → null (no answer, no digit prefix, no known subject prefix)", () => {
    expect(ncertMapper("readme.pdf")).toBeNull();
    expect(ncertMapper("Geography-Chapter.pdf")).toBeNull(); // "Geo" is a prefix but "Geography" isn't the token
  });
});
