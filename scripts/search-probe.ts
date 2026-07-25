// Latency probe for the RAG search rung (§15 rung 4, A-7). Times searchChunks() over the LIVE,
// fully-ingested corpus and reports per-query ms + p50/p95, exiting non-zero if p95 > the budget.
// This is the honest "<100ms" proof the blueprint asks for — run it AFTER `npm run ingest:corpus`.
//
//   npm run search:probe            (default budget 100ms)
//   npm run search:probe -- 50      (custom budget)
import { performance } from "node:perf_hooks";
import { prisma } from "@/server/db";
import { createPostgresStore } from "@/server/knowledge/store/postgres";

const BUDGET_MS = Number(process.argv[2] ?? 100);
const QUERIES = [
  "real numbers",
  "prime factorisation of a composite number",
  "quadratic equation roots discriminant",
  "arithmetic progression nth term",
  "trigonometric ratios of a right triangle",
  "area of a sector of a circle",
  "probability of an event",
  "coordinate geometry distance formula",
];
const WARMUP = 2; // first query pays plan/connection cost — don't let it skew the percentiles

async function main() {
  const store = createPostgresStore();

  for (let i = 0; i < WARMUP; i++) await store.searchChunks(QUERIES[0], { limit: 8 });

  const times: number[] = [];
  for (const q of QUERIES) {
    const t0 = performance.now();
    const hits = await store.searchChunks(q, { limit: 8 });
    const ms = performance.now() - t0;
    times.push(ms);
    console.log(`  ${ms.toFixed(1).padStart(6)}ms  ${String(hits.length).padStart(2)} hits  "${q}"`);
    if (hits.length === 0) console.log(`     ⚠️  0 hits — corpus not ingested? run: npm run ingest:corpus`);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const p50 = pct(50);
  const p95 = pct(95);
  const max = sorted[sorted.length - 1];

  console.log(`\n=== SEARCH LATENCY (${QUERIES.length} queries, budget ${BUDGET_MS}ms) ===`);
  console.log(`p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · max ${max.toFixed(1)}ms`);

  await prisma.$disconnect();
  if (p95 > BUDGET_MS) {
    console.error(`\n❌ p95 ${p95.toFixed(1)}ms exceeds budget ${BUDGET_MS}ms`);
    process.exit(1);
  }
  console.log(`\n✅ p95 within ${BUDGET_MS}ms budget`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
