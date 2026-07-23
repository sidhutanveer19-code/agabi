import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractPdfText } from "@/server/ingest/pdf/extractText";
import { pdfTextToMarkdown } from "@/server/ingest/pdf/toMarkdown";
import { sha256, slugify } from "@/server/knowledge/ids";
import { DatasetManifestSchema, type DatasetManifest } from "@/server/content/dataset";
import type { SourceTier } from "@/server/ingest/sourcePriority";

/**
 * Dataset builder (Phase C). Converts a directory of licensed PDFs into a canonical Agabi dataset
 * package: `manifest.json` (id/name/profile/license/version/attribution + per-source hash) + one
 * markdown chapter per source. Reuses M1 (extractText + toMarkdown). The package becomes the canonical,
 * reproducible source the orchestrator populates from. The operator asserts the licence (§24); no
 * copyrighted content is fetched — it is converted from files the operator supplied.
 */
export interface SourceMeta {
  subject: string;
  chapter: string;
}
export type MetaMapper = (filename: string) => SourceMeta | null; // null → skip (e.g. answer keys)

export interface BuildOptions {
  id: string;
  name: string;
  profile?: string;
  license: string;
  version: string;
  tier?: SourceTier;
  attribution?: { author: string; sourceUrl?: string; retrievalDate?: string };
  mapper: MetaMapper;
}

export interface BuildResult {
  outDir: string;
  chapters: number;
  skipped: string[];
  totalChars: number;
  noiseDropped: number;
}

export async function buildDatasetFromPdfs(pdfDir: string, outDir: string, opts: BuildOptions): Promise<BuildResult> {
  mkdirSync(join(outDir, "chapters"), { recursive: true });
  const sources: DatasetManifest["sources"] = [];
  const skipped: string[] = [];
  let totalChars = 0;
  let noiseDropped = 0;

  for (const file of readdirSync(pdfDir).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const meta = opts.mapper(file);
    if (!meta) { skipped.push(file); continue; }
    const { text } = await extractPdfText(readFileSync(join(pdfDir, file)));
    const md = pdfTextToMarkdown(text, meta.chapter);
    totalChars += text.length;
    noiseDropped += md.droppedNoiseLines;
    const ref = `chapters/${slugify(meta.subject)}-${slugify(meta.chapter)}.md`;
    writeFileSync(join(outDir, ref), md.markdown);
    sources.push({ ref, format: "markdown", subject: meta.subject, chapter: meta.chapter, tier: opts.tier, hash: sha256(md.markdown).slice(0, 16) });
  }

  const manifest: DatasetManifest = DatasetManifestSchema.parse({
    id: opts.id, name: opts.name, profile: opts.profile ?? "generic", license: opts.license, version: opts.version, attribution: opts.attribution, sources,
  });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { outDir, chapters: sources.length, skipped, totalChars, noiseDropped };
}

/** NCERT CBSE Class-10 filename → {subject, chapter}. Answer keys are skipped. */
export function ncertMapper(file: string): SourceMeta | null {
  const name = file.replace(/\.pdf$/i, "");
  if (/answers?/i.test(name)) return null;
  if (/^\d+-/.test(name)) return { subject: "Mathematics", chapter: name.replace(/^\d+-/, "").replace(/-/g, " ").trim() };
  const m = /^(English|SocSci|Science|Sci|Hist|Geo|Eco|Pol)[-_](.+)$/i.exec(name);
  if (m) {
    const subject = /english/i.test(m[1]) ? "English" : /^sci/i.test(m[1]) || /science/i.test(m[1]) ? "Science" : "Social Science";
    return { subject, chapter: m[2].replace(/[-_]/g, " ").trim() };
  }
  return null;
}
