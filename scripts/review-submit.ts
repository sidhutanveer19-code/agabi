// Review submit (A3) — decisions.json → ReviewEvents, through the ONLY sanctioned path
// (`submitStatementReview` → `applyReview` → `store.commitReview`). No script writes trust directly.
//
//   npm run review:submit -- decisions.json [--dry]
//
// Every decision is applied one at a time and REPORTED: promoted, unchanged, or failed with the
// error. A decision that does not move trust is not a silent no-op — it is printed with the reason
// the ladder gave (R1). Nothing is skipped without a line in the summary.
import { readFileSync } from "node:fs";
import { createPostgresStore } from "@/server/knowledge/store/postgres";
import { submitStatementReview, type GovernanceConfig } from "@/server/knowledge/review";
import type { ReviewDecision } from "@/server/knowledge/review/decide";

const path = process.argv[2];
const dry = process.argv.includes("--dry");
if (!path) {
  console.error("usage: npm run review:submit -- decisions.json [--dry]");
  process.exit(2);
}

// Governance for a single-reviewer M3 (§26.2, D4): expert-only, reputation inert until M6.
const GOVERNANCE: GovernanceConfig = {
  designatedAuthorities: new Set<string>(),
  reviewerReputation: () => 0,
  isCredentialedExpert: () => true,
  communityThreshold: 3,
};

async function main() {
  const decisions = JSON.parse(readFileSync(path, "utf8")) as ReviewDecision[];
  const store = createPostgresStore();
  const started = Date.now();
  const outcomes: { targetId: string; decision: string; from: string | null; to: string | null; note: string }[] = [];

  for (const d of decisions) {
    if (dry) { outcomes.push({ targetId: d.targetId, decision: d.decision, from: null, to: null, note: "dry run — not committed" }); continue; }
    try {
      const before = await store.getStatementRaw(d.targetId);
      const { event, effect } = await submitStatementReview(store, { ...d, targetKind: "Statement" }, "reviewer", GOVERNANCE);
      const to = effect.trustLevel ?? null;
      outcomes.push({
        targetId: d.targetId,
        decision: event.decision,
        from: before?.trustLevel ?? null,
        to,
        note: to ? "trust changed" : "event recorded, trust unchanged (ladder conditions not met — see §26.2)",
      });
    } catch (e) {
      outcomes.push({ targetId: d.targetId, decision: d.decision, from: null, to: null, note: `FAILED: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const minutes = (Date.now() - started) / 60000;
  const promoted = outcomes.filter((o) => o.to).length;
  const failed = outcomes.filter((o) => o.note.startsWith("FAILED")).length;
  const unchanged = outcomes.length - promoted - failed;

  console.log(`=== REVIEW SUBMIT ===`);
  console.log(`decisions:  ${outcomes.length}${dry ? " (DRY RUN)" : ""}`);
  console.log(`promoted:   ${promoted}`);
  console.log(`unchanged:  ${unchanged}`);
  console.log(`failed:     ${failed}`);
  for (const o of outcomes.filter((x) => !x.to)) console.log(`   · ${o.targetId} [${o.decision}] — ${o.note}`);
  if (!dry && minutes > 0) console.log(`\nK6 throughput (submit only, excludes reading): ${(outcomes.length / minutes).toFixed(0)}/hr-equivalent over ${minutes.toFixed(2)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
