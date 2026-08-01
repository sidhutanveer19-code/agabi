import { BENCHMARK, type BenchCase, type Capability } from "./dataset";

/**
 * Benchmark Loader / Validator — the ONE gate the labelled ground truth passes through before any KPI
 * is computed against it. No I/O beyond importing the in-memory dataset. A malformed corpus (duplicate
 * id, empty message, unknown capability) is a silent poison of every downstream KPI, so it fails LOUDLY
 * here (Law 11 — never fail silently) instead of quietly skewing a rate. `benchmarkStats` gives the
 * measured shape of the corpus so coverage of each intent/capability is a number, not a hope (L1).
 */

/** The closed set of valid capabilities — the authority `assertWellFormed` checks each row against. */
const CAPABILITIES: readonly Capability[] = ["TEACH", "GREET", "ANSWER", "CLARIFY", "REFUSE_OFF_SYLLABUS"];

/**
 * Throw (loudly) on any structural defect that would poison the KPIs: a duplicate id (double-counts a
 * case), an empty/whitespace-only message (an unlabelable row), or an unknown capability (an out-of-set
 * routing target). Total: it inspects every row and names the first offending id in the error.
 */
export function assertWellFormed(cases: BenchCase[]): void {
  const seen = new Set<string>();
  const allowed = new Set<Capability>(CAPABILITIES);
  for (const c of cases) {
    if (c.id.length === 0) {
      throw new Error("Benchmark malformed: a case has an empty id");
    }
    if (seen.has(c.id)) {
      throw new Error(`Benchmark malformed: duplicate id "${c.id}"`);
    }
    seen.add(c.id);
    if (c.message.trim().length === 0) {
      throw new Error(`Benchmark malformed: empty message for id "${c.id}"`);
    }
    if (!allowed.has(c.expectedCapability)) {
      throw new Error(`Benchmark malformed: unknown capability "${c.expectedCapability}" for id "${c.id}"`);
    }
  }
}

/** Validate then hand back the canonical labelled corpus. The single entry point production/tests use —
 *  a caller can never obtain an unvalidated BENCHMARK through this loader. */
export function loadBenchmark(): BenchCase[] {
  assertWellFormed(BENCHMARK);
  return BENCHMARK;
}

/** The measured shape of a corpus: total rows and the count per capability, per intent, and per tag —
 *  so "does the benchmark exercise every routing target" is answered with numbers, not assertion. */
export interface BenchmarkStats {
  total: number;
  byCapability: Record<Capability, number>;
  byIntent: Record<string, number>;
  tagCounts: Record<string, number>;
}

/** Count the corpus across capability, intent, and tag. Total (empty input → all-zero counts). */
export function benchmarkStats(cases: BenchCase[]): BenchmarkStats {
  const byCapability: Record<Capability, number> = {
    TEACH: 0,
    GREET: 0,
    ANSWER: 0,
    CLARIFY: 0,
    REFUSE_OFF_SYLLABUS: 0,
  };
  const byIntent: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const c of cases) {
    byCapability[c.expectedCapability] += 1;
    byIntent[c.expectedIntent] = (byIntent[c.expectedIntent] ?? 0) + 1;
    for (const tag of c.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }
  return { total: cases.length, byCapability, byIntent, tagCounts };
}
