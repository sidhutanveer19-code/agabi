// Review export (A3) — live store → proposals.json, the input `scripts/review-cli.mjs` expects.
//
//   npm run review:export -- [out.json] [limit]
//
// R1: statements that exist but cannot be reviewed (no provenance, or provenance pointing at a
// chunk that was never stored) are NOT quietly filtered out — they are counted, listed in the
// output under `unreviewable`, and printed with their reason.
import { writeFileSync } from "node:fs";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { buildPendingQueue } from "@/server/knowledge/review/pending";
import { SCREEN_SIZE } from "@/server/knowledge/review/batch";

const out = process.argv[2] ?? "proposals.json";
const limit = process.argv[3] ? Number(process.argv[3]) : undefined;

async function main() {
  const store = createPostgresStore();
  const q = await buildPendingQueue(store, { ...(limit ? { limit } : {}) });

  // The CLI's contract: { targetId, chunkText, quote, text, validation[] }.
  const payload = q.proposals.map((p) => ({
    targetId: p.targetId,
    targetKind: p.targetKind,
    chunkText: p.chunkText,
    quote: p.quote,
    text: p.statement.text,
    form: p.statement.form,
    kind: p.statement.kind,
    sourceId: p.sourceId,
    chunkId: p.chunkId,
    subjectId: p.statement.subjectId,
    validation: p.validation.map((v) => ({ validator: v.validator, outcome: v.outcome, ...(v.reason ? { reason: v.reason } : {}) })),
    ...(p.degraded ? { degraded: p.degraded } : {}),
  }));
  writeFileSync(out, JSON.stringify(payload, null, 2));
  writeFileSync(out.replace(/\.json$/, "") + ".unreviewable.json", JSON.stringify(q.unreviewable, null, 2));

  console.log(`=== REVIEW QUEUE ===`);
  console.log(`pending (awaiting a human — MACHINE_PROPOSED + AUTO_VALIDATED): ${q.totals.pending}`);
  console.log(`reviewable:                 ${q.totals.reviewable}  → ${out} (${Math.ceil(payload.length / SCREEN_SIZE)} screens of ${SCREEN_SIZE})`);
  console.log(`UNREVIEWABLE:               ${q.totals.unreviewable}`);
  const byReason = new Map<string, number>();
  for (const u of q.unreviewable) {
    const key = u.reason.replace(/chunk \S+/, "chunk <id>");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of byReason) console.log(`   · ${n} × ${reason}`);
  const degraded = payload.filter((p) => "degraded" in p).length;
  if (degraded) console.log(`degraded (no subject concept): ${degraded}`);
  console.log(`\nnext: node scripts/review-cli.mjs ${out} decisions.json   then   npm run review:submit -- decisions.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
