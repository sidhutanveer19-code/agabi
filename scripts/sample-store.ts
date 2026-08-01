// Store sampling (Stage 4) — inspect real persisted objects end to end, read-only.
//
//   npm run sample -- [--n 50] [--json out.json] [--unattached] [--barren]
//
// The ≥50-object inspection that was previously impossible: nothing joined an object to its source
// text, its provenance, its review history and its derived lifecycle. This composes existing reads
// only — dumpAll → provenanceFor → getSourceChunk → reviewEventsFor → lifecycleOf.
//
// Two honest limitations, stated rather than papered over:
//  · Validator output is computed at ingest and NOT persisted, so gate results here are RECOMPUTED
//    from the stored chunk (possible only because ingest now persists chunks, A2).
//  · There is no numeric confidence field anywhere. `trustLevel` + `validationMethods` +
//    `corroborationCount` are the proxies; anything presented as a confidence score would be invented.
import { writeFileSync } from "node:fs";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { lifecycleOf } from "@/server/knowledge/lifecycle/lifecycle";
import { revalidate } from "@/server/knowledge/review/pending";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const n = Number(arg("--n") ?? 50);
const jsonOut = arg("--json");
const onlyUnattached = process.argv.includes("--unattached");
const onlyBarren = process.argv.includes("--barren");

async function main() {
  const store = createPostgresStore();
  const dump = await store.dumpAll();

  const conceptById = new Map(dump.concepts.map((c) => [c.id, c]));
  const chunkById = new Map(dump.sourceChunks.map((c) => [c.id, c]));
  const sourceById = new Map(dump.sources.map((s) => [s.id, s]));
  const provByStatement = new Map<string, typeof dump.provenance>();
  for (const p of dump.provenance) provByStatement.set(p.statementId, [...(provByStatement.get(p.statementId) ?? []), p]);
  const reviewsByTarget = new Map<string, string[]>();
  for (const r of dump.reviewEvents) reviewsByTarget.set(r.targetId, [...(reviewsByTarget.get(r.targetId) ?? []), r.decision]);
  const supersededIds = new Set(dump.statements.map((s) => s.supersedes).filter((x): x is string => !!x));

  let pool = dump.statements;
  if (onlyUnattached) pool = pool.filter((s) => !s.subjectId);

  const samples = pool.slice(0, n).map((s) => {
    const prov = provByStatement.get(s.id) ?? [];
    const p = prov[0];
    const chunk = p ? chunkById.get(p.chunkId) : undefined;
    const source = p ? sourceById.get(p.sourceId) : undefined;
    const decisions = reviewsByTarget.get(s.id) ?? [];
    return {
      statementId: s.id,
      form: s.form,
      kind: s.kind,
      text: s.text,
      subject: s.subjectId ? (conceptById.get(s.subjectId)?.name ?? `<missing concept ${s.subjectId}>`) : null,
      trustLevel: s.trustLevel,
      validationMethods: s.validationMethods,
      corroborationCount: s.corroborationCount,
      lifecycle: lifecycleOf({ trustLevel: s.trustLevel, superseded: supersededIds.has(s.id), decisions }),
      reviewDecisions: decisions,
      provenance: p
        ? {
            sourceTitle: source?.title ?? `<missing source ${p.sourceId}>`,
            license: source?.license ?? null,
            chunkId: p.chunkId,
            chunkResolves: !!chunk,
            quote: p.quote,
            modelId: p.modelId,
            promptVersion: p.promptVersion,
            // recomputed, because ingest-time validator output is not persisted
            gatesNow: chunk ? revalidate(s, p.quote, chunk.text).map((v) => `${v.validator}:${v.outcome}${v.reason ? `(${v.reason})` : ""}`) : ["<chunk not in store — cannot recheck>"],
          }
        : null,
    };
  });

  const barren = onlyBarren ? dump.sourceChunks.filter((c) => !dump.provenance.some((p) => p.chunkId === c.id)) : [];

  console.log(`=== STORE SAMPLE (${samples.length} of ${pool.length} statements${onlyUnattached ? ", unattached only" : ""}) ===\n`);
  for (const s of samples) {
    console.log(`[${s.statementId}] ${s.form}/${s.kind}  trust=${s.trustLevel}  lifecycle=${s.lifecycle}`);
    console.log(`   about:  ${s.subject ?? "— NO SUBJECT CONCEPT (reachable from nothing)"}`);
    console.log(`   says:   ${s.text}`);
    if (s.provenance) {
      console.log(`   source: ${s.provenance.sourceTitle} [${s.provenance.license}] · model=${s.provenance.modelId} · prompt=${s.provenance.promptVersion}`);
      console.log(`   quote:  "${s.provenance.quote.slice(0, 120)}"${s.provenance.quote.length > 120 ? "…" : ""}`);
      console.log(`   gates:  ${s.provenance.gatesNow.join(" ")}`);
    } else {
      console.log(`   source: NONE — this statement traces to nothing`);
    }
    console.log(`   review: ${s.reviewDecisions.length ? s.reviewDecisions.join(", ") : "(never reviewed)"}\n`);
  }

  const withSubject = samples.filter((s) => s.subject).length;
  const resolving = samples.filter((s) => s.provenance?.chunkResolves).length;
  const passingV3 = samples.filter((s) => s.provenance?.gatesNow.some((g) => g.startsWith("V3:pass"))).length;
  console.log(`--- sample summary ---`);
  console.log(`with a subject concept:      ${withSubject}/${samples.length}`);
  console.log(`provenance chunk resolves:   ${resolving}/${samples.length}`);
  console.log(`still grounded (V3 re-run):  ${passingV3}/${samples.length}`);
  console.log(`reviewed by a human:         ${samples.filter((s) => s.reviewDecisions.length).length}/${samples.length}`);
  if (onlyBarren) {
    console.log(`\n--- barren chunks: ${barren.length} ---`);
    for (const c of barren.slice(0, 20)) console.log(`  ${c.id.slice(0, 12)} ord=${c.ordinal} chars=${c.text.length}  "${c.text.slice(0, 90).replace(/\n/g, " ")}…"`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), samples, barren }, null, 2));
    console.log(`\nfull sample → ${jsonOut}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
