// Population Controller (Phase E). Runs the REAL pipeline (Ollama, no fakes) over every chapter of a
// built dataset package into the LIVE postgres store — chapter by chapter, checkpointed after each,
// resumable (never restarts from chapter 1), idempotent. Everything MACHINE_PROPOSED → review queue.
// Run: npx tsx scripts/populate-corpus.ts [dataset-dir] [model]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "@/server/content/dataset";
import { ingestSource } from "@/server/content/orchestrator";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { ollamaInvoker } from "@/server/advisors/knowledge/invoke";
import { localFilesystemConnector } from "@/server/ingest/connectors/localFilesystem";
import { buildHierarchy } from "@/server/ingest/discovery/hierarchy";
import { getProfile, GENERIC_PROFILE } from "@/server/ingest/discovery/profile";

const DIR = process.argv[2] ?? "datasets/.generated/cbse-class10";
const model = process.argv[3] ?? "qwen2.5:7b";
const CKPT = join(DIR, ".population-checkpoint.json");

async function main() {
  const manifest = loadManifest(DIR);
  const done: Set<string> = existsSync(CKPT) ? new Set((JSON.parse(readFileSync(CKPT, "utf8")).done as string[])) : new Set();
  const store = createPostgresStore();
  const invoke = ollamaInvoker(process.env.OLLAMA_BASE_URL ?? "http://localhost:11434", model, new AbortController().signal);
  const profile = getProfile(manifest.profile) ?? GENERIC_PROFILE;
  const discover = (doc: Parameters<typeof buildHierarchy>[0]) => buildHierarchy(doc, profile);

  const queue = manifest.sources.filter((s) => !done.has(s.ref));
  console.log(`[controller] corpus=${manifest.sources.length} done=${done.size} queue=${queue.length} model=${model} store=postgres`);
  const t0 = Date.now();
  let processed = 0;

  for (const src of queue) {
    const t = Date.now();
    const connector = localFilesystemConnector({ license: manifest.license });
    try {
      const r = await ingestSource(store, connector, join(DIR, src.ref), invoke, { modelId: model, format: src.format, discover });
      done.add(src.ref);
      writeFileSync(CKPT, JSON.stringify({ done: [...done], updatedAt: new Date().toISOString() }, null, 0));
      processed++;
      console.log(`[${done.size}/${manifest.sources.length}] ${src.subject ?? "?"} / ${src.chapter ?? src.ref}  →  concepts+${r.counts.concepts} statements+${r.counts.statements} edges+${r.counts.edges} assets+${r.counts.assets} items+${r.counts.items} dup-skip+${r.counts.duplicatesSkipped}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    } catch (e) {
      console.log(`[ERR] ${src.ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`[controller] run complete: +${processed} chapters this run, ${done.size}/${manifest.sources.length} total, ${((Date.now() - t0) / 60000).toFixed(1)}min`);
}
main().catch((e) => { console.error(e); process.exit(1); });
