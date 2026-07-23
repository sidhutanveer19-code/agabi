// Population Controller (Stage 3). Runs the REAL pipeline (Ollama, no fakes) over every chapter of
// a built dataset package into the LIVE store — chapter by chapter, checkpointed after each,
// resumable (never restarts from chapter 1), idempotent. Everything MACHINE_PROPOSED → review queue.
//
//   npm run populate -- [dataset-dir] [model] [--limit N] [--only <substring>]
//
// R1 — never silently skip. Every chapter writes a record to `<dir>/.population-report.json`
// containing its counts AND its full omission ledger (batch discards with the zod path, each
// rejected proposal with the gate that killed it and that gate's reason, subject-unresolved,
// duplicates with what they collapsed into, barren chunks with why). A chapter that throws is
// recorded with the error and is NOT marked done, so a resume retries it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "@/server/content/dataset";
import { ingestSource } from "@/server/content/orchestrator";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { ollamaInvoker, nativeOllamaBase } from "@/server/advisors/knowledge/invoke";
import { localFilesystemConnector } from "@/server/ingest/connectors/localFilesystem";
import { buildHierarchy } from "@/server/ingest/discovery/hierarchy";
import { getProfile, GENERIC_PROFILE } from "@/server/ingest/discovery/profile";
import { compareTiers } from "@/server/ingest/sourcePriority";
import { summariseOmissions, type Omission } from "@/server/content/omissions";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

const DIR = positional[0] ?? "datasets/.generated/cbse-class10";
const model = positional[1] ?? "qwen2.5:7b";
const limit = flag("--limit") ? Number(flag("--limit")) : undefined;
const only = flag("--only");
const CKPT = join(DIR, ".population-checkpoint.json");
const CHUNK_CKPT = join(DIR, ".chunk-checkpoint.json");
const REPORT = join(DIR, ".population-report.json");

interface ChapterRecord {
  ref: string;
  subject?: string;
  chapter?: string;
  hash?: string;
  status: "ok" | "failed";
  seconds: number;
  sourceId?: string;
  counts?: Record<string, number>;
  omissionsByKind?: Record<string, number>;
  omissions?: Omission[];
  error?: string;
}

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

async function main() {
  const manifest = loadManifest(DIR);
  // Checkpoint key includes the content hash: an EDITED chapter re-queues instead of being
  // silently skipped as already done (a bare ref made a corpus fix invisible to a resume).
  const key_ = (s: { ref: string; hash?: string }) => `${s.ref}@${s.hash ?? "nohash"}`;
  const done = new Set(loadJson<{ done: string[] }>(CKPT, { done: [] }).done);
  const records = loadJson<ChapterRecord[]>(REPORT, []);

  // Chunk-level progress, keyed by chapter. Chunk ids are content-addressed, so this is exact and
  // survives a restart: a chapter that died on its last chunk resumes THERE instead of re-paying
  // ~4.5 minutes of model time per already-extracted chunk.
  const chunkDone = loadJson<Record<string, string[]>>(CHUNK_CKPT, {});
  const saveChunks = () => writeFileSync(CHUNK_CKPT, JSON.stringify(chunkDone, null, 0));

  const store = createPostgresStore();
  // Ctrl-C stops the run deliberately; a chunk failure does not.
  const ac = new AbortController();
  process.on("SIGINT", () => { console.log("\n[controller] SIGINT — finishing the current call, then stopping"); ac.abort(); });

  let retries = 0;
  const invoke = ollamaInvoker(nativeOllamaBase(process.env.OLLAMA_BASE_URL), model, ac.signal, {
    onRetry: ({ attempt, delayMs, error }) => {
      retries++;
      console.log(`   [retry ${attempt}/3 in ${delayMs / 1000}s] ${error}`);
    },
  });
  const profile = getProfile(manifest.profile) ?? GENERIC_PROFILE;
  const discover = (doc: Parameters<typeof buildHierarchy>[0]) => buildHierarchy(doc, profile);

  // Highest-trust sources first (source priority) — the same ordering loadDataset applies.
  // Stable: equal tiers keep manifest order.
  const ordered = manifest.sources
    .map((s, i) => ({ s, i }))
    .sort((a, b) => compareTiers(a.s.tier, b.s.tier) || a.i - b.i)
    .map((x) => x.s);

  let queue = ordered.filter((s) => !done.has(key_(s)));
  if (only) queue = queue.filter((s) => s.ref.includes(only) || (s.chapter ?? "").toLowerCase().includes(only.toLowerCase()));
  if (limit) queue = queue.slice(0, limit);

  const requeued = ordered.filter((s) => !done.has(key_(s)) && [...done].some((d) => d.startsWith(s.ref + "@")));
  console.log(`[controller] corpus=${manifest.sources.length} done=${done.size} queue=${queue.length} model=${model} store=postgres`);
  if (requeued.length) console.log(`[controller] ${requeued.length} chapter(s) re-queued — content hash changed since they were ingested`);

  const t0 = Date.now();
  let processed = 0;

  for (const src of queue) {
    const t = Date.now();
    const connector = localFilesystemConnector({ license: manifest.license });
    const base: ChapterRecord = { ref: src.ref, subject: src.subject, chapter: src.chapter, hash: src.hash, status: "failed", seconds: 0 };
    try {
      const key = key_(src);
      const already = new Set(chunkDone[key] ?? []);
      const r = await ingestSource(store, connector, join(DIR, src.ref), invoke, {
        modelId: model, format: src.format, discover, signal: ac.signal,
        skipChunkIds: already,
        onChunkDone: (chunkId) => { already.add(chunkId); chunkDone[key] = [...already]; saveChunks(); },
      });
      done.add(key_(src));
      delete chunkDone[key_(src)]; // chapter complete — its chunk progress is no longer needed
      saveChunks();
      writeFileSync(CKPT, JSON.stringify({ done: [...done], updatedAt: new Date().toISOString() }, null, 0));
      processed++;
      const rec: ChapterRecord = {
        ...base,
        status: "ok",
        seconds: (Date.now() - t) / 1000,
        sourceId: r.sourceId,
        counts: { ...r.counts },
        omissionsByKind: summariseOmissions(r.omissions),
        omissions: r.omissions,
      };
      records.push(rec);
      writeFileSync(REPORT, JSON.stringify(records, null, 2));
      console.log(
        `[${done.size}/${manifest.sources.length}] ${src.subject ?? "?"} / ${src.chapter ?? src.ref}  →  ` +
          `concepts+${r.counts.concepts} statements+${r.counts.statements} edges+${r.counts.edges} assets+${r.counts.assets} items+${r.counts.items}  ` +
          `| rejected s=${r.counts.statementsRejected} d=${r.counts.dependenciesRejected} · barren=${r.counts.barrenChunks}/${r.counts.chunks} · failed=${r.counts.chunkFailures} · skipped=${r.counts.skippedChunks} · unattached=${r.counts.unattachedStatements} · dup=${r.counts.duplicatesSkipped} · omissions=${r.omissions.length}  (${((Date.now() - t) / 1000).toFixed(0)}s)`,
      );
    } catch (e) {
      // R1: a failure is recorded, printed, and left OUT of the checkpoint so a resume retries it.
      const rec: ChapterRecord = { ...base, seconds: (Date.now() - t) / 1000, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      records.push(rec);
      writeFileSync(REPORT, JSON.stringify(records, null, 2));
      console.log(`[ERR] ${src.ref}: ${rec.error}  — NOT marked done, will retry on resume`);
    }
  }

  const ok = records.filter((r) => r.status === "ok");
  const failed = records.filter((r) => r.status === "failed");
  const sum = (pick: (r: ChapterRecord) => number) => ok.reduce((n, r) => n + pick(r), 0);
  console.log(`\n[controller] run complete: +${processed} chapters this run, ${done.size}/${manifest.sources.length} total, ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  console.log(`[totals over ${ok.length} chapter record(s)] concepts=${sum((r) => r.counts?.concepts ?? 0)} statements=${sum((r) => r.counts?.statements ?? 0)} edges=${sum((r) => r.counts?.edges ?? 0)} assets=${sum((r) => r.counts?.assets ?? 0)} items=${sum((r) => r.counts?.items ?? 0)}`);
  console.log(`[omissions] ${sum((r) => r.omissions?.length ?? 0)} recorded — full ledger in ${REPORT}`);
  if (retries) console.log(`[retries] ${retries} transient model failure(s) recovered without losing a chapter`);
  const byKind: Record<string, number> = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.omissionsByKind ?? {})) byKind[k] = (byKind[k] ?? 0) + v;
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`   · ${k}: ${v}`);
  if (failed.length) {
    console.log(`[FAILED CHAPTERS] ${failed.length}`);
    for (const f of failed) console.log(`   · ${f.ref} — ${f.error}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
