/**
 * Evaluation Engine — pure KPI math. THE single place classification/rate KPIs are computed (L5:
 * Single Source of Truth). No I/O, no model: deterministic functions over labelled pairs, so a KPI
 * is a measured number, never a feeling (L1). Owned by the Evaluation World; imported by nothing in
 * production. Every function is total (empty input → 0, never NaN / divide-by-zero).
 */

export interface LabeledPair {
  predicted: string;
  actual: string;
}

export interface ClassScore {
  precision: number; // TP / (TP + FP) — of what we predicted this class, how much was right
  recall: number; // TP / (TP + FN) — of the real members of this class, how many we found
  f1: number; // harmonic mean of precision & recall
  support: number; // count of actual members of this class
}

export interface ClassificationMetrics {
  accuracy: number; // correct / total
  perClass: Record<string, ClassScore>;
  confusion: Record<string, Record<string, number>>; // confusion[predicted][actual] = count
}

const f1Of = (precision: number, recall: number): number =>
  precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

/** Accuracy, per-class precision/recall/F1, and the full confusion matrix over predicted vs actual. */
export function classificationMetrics(pairs: LabeledPair[]): ClassificationMetrics {
  const total = pairs.length;
  if (total === 0) return { accuracy: 0, perClass: {}, confusion: {} };

  const classes = new Set<string>();
  const confusion: Record<string, Record<string, number>> = {};
  let correct = 0;
  const tp: Record<string, number> = {};
  const predictedCount: Record<string, number> = {}; // TP + FP
  const actualCount: Record<string, number> = {}; // TP + FN

  for (const c of pairs) {
    classes.add(c.predicted);
    classes.add(c.actual);
    (confusion[c.predicted] ??= {})[c.actual] = (confusion[c.predicted]?.[c.actual] ?? 0) + 1;
    predictedCount[c.predicted] = (predictedCount[c.predicted] ?? 0) + 1;
    actualCount[c.actual] = (actualCount[c.actual] ?? 0) + 1;
    if (c.predicted === c.actual) {
      correct++;
      tp[c.predicted] = (tp[c.predicted] ?? 0) + 1;
    }
  }

  const perClass: Record<string, ClassScore> = {};
  for (const cls of classes) {
    const truePos = tp[cls] ?? 0;
    const precision = predictedCount[cls] ? truePos / predictedCount[cls] : 0;
    const recall = actualCount[cls] ? truePos / actualCount[cls] : 0;
    perClass[cls] = { precision, recall, f1: f1Of(precision, recall), support: actualCount[cls] ?? 0 };
  }

  return { accuracy: correct / total, perClass, confusion };
}

/** Fraction of rows where `predicate` holds — the shape of every safety KPI (Wrong-Teaching,
 *  Unsafe-Routing, Unknown-Detection). Empty → 0. A single violation is visible (1/N), so a
 *  "must be 0" invariant is provable, not asserted. */
export function rate<T>(rows: T[], predicate: (row: T) => boolean): number {
  if (rows.length === 0) return 0;
  return rows.filter(predicate).length / rows.length;
}

/** |mean stated confidence − empirical correctness| — how honest the model's confidence is. */
export function calibrationError(rows: { confidence: number; correct: boolean }[]): number {
  if (rows.length === 0) return 0;
  const meanConfidence = rows.reduce((s, r) => s + r.confidence, 0) / rows.length;
  const empirical = rows.filter((r) => r.correct).length / rows.length;
  return Math.abs(meanConfidence - empirical);
}
