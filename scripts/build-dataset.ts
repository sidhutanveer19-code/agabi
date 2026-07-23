// Dataset builder CLI (Phase C). Converts a directory of operator-supplied licensed PDFs into a
// canonical Agabi dataset package (manifest + one markdown chapter per source + build-report.json).
//
//   npm run dataset:build -- <pdf-dir> [out-dir]
//
// R1: prints the omission summary and points at build-report.json, which lists EVERY skipped file,
// every dropped line (page numbers, page markers, running headers) and every faux-bold repair.
import { buildDatasetFromPdfs, ncertMapper } from "@/server/content/datasetBuilder";

const pdfDir = process.argv[2];
const outDir = process.argv[3] ?? "datasets/.generated/cbse-class10";

if (!pdfDir || pdfDir === "--help") {
  console.error("usage: npm run dataset:build -- <pdf-dir> [out-dir]");
  process.exit(pdfDir ? 0 : 2);
}

async function main() {
  const r = await buildDatasetFromPdfs(pdfDir, outDir, {
    id: "cbse-class10",
    name: "CBSE Class 10 (NCERT)",
    profile: "generic",
    license: "NCERT-operator-asserted",
    version: "2026",
    tier: "OFFICIAL_TEXTBOOK",
    attribution: { author: "NCERT", sourceUrl: "https://ncert.nic.in", retrievalDate: "2026-07" },
    mapper: ncertMapper,
  });

  console.log(`\n=== DATASET BUILD ===`);
  console.log(`out:        ${r.outDir}`);
  console.log(`chapters:   ${r.chapters}`);
  console.log(`raw chars:  ${r.totalChars.toLocaleString()}`);
  console.log(`dropped:    ${r.noiseDropped} noise lines`);
  console.log(`repaired:   ${r.repairsMade} faux-bold lines`);
  console.log(`skipped:    ${r.skipped.length} file(s)`);
  for (const s of r.skipped) console.log(`   · ${s.file} — ${s.reason}`);

  const byRule = new Map<string, number>();
  for (const rec of r.records) for (const d of rec.drops) byRule.set(d.rule, (byRule.get(d.rule) ?? 0) + 1);
  console.log(`drops by rule: ${[...byRule].map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`);
  console.log(`full omission record → ${r.outDir}/build-report.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
