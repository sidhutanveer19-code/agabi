/**
 * Evidence Verification — anti-hallucination release gate. PURE logic: no I/O, no
 * model, deterministic functions over strings. THE single place a delivered lesson
 * block is checked against its source passages (L5: Single Source of Truth), so
 * "grounded" is a measured number, never a feeling (L1).
 *
 * Why it exists: a delivered block must never STATE a factual claim that isn't
 * traceable to a source passage. Analogies and framing ("scaffolding") are teaching
 * moves, not facts, so they are exempt from grounding — but they are still excluded
 * from the groundedness denominator so they never inflate or deflate the score.
 *
 * No embeddings (this project bans vector search) — grounding is LEXICAL: content-token
 * overlap between a claim and the best-matching passage. Every function is total
 * (empty input → a defined value, never NaN / throw).
 */

/** How a single claim stands relative to the source passages. */
export type ClaimLabel = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED" | "SCAFFOLDING";

/** An atomic claim extracted from a block. `scaffolding` = a teaching move (analogy,
 *  rhetorical question, framing, meta) that asserts no groundable fact. */
export interface Claim {
  text: string;
  kind: "factual" | "scaffolding";
}

/**
 * Overlap thresholds (fraction of a claim's content tokens found in a passage).
 * STRONG = "the passage asserts essentially the whole claim" → SUPPORTED (or, under
 * negation, CONTRADICTED). PARTIAL = "some but not most of the claim is grounded"
 * → PARTIALLY_SUPPORTED. Tuned so the boundaries are meaningful and testable: 3/5
 * clears STRONG, 3/10 clears PARTIAL, 2/10 clears neither.
 */
export const STRONG_THRESHOLD = 0.6;
export const PARTIAL_THRESHOLD = 0.3;

/** Small closed-class stopword set: function words that carry no grounding signal.
 *  (Tokens shorter than 3 chars are dropped separately, so most function words —
 *  is/of/to/in/it — never reach here.) */
const STOPWORDS = new Set<string>([
  "the", "and", "for", "are", "was", "has", "had", "have", "this", "that",
  "with", "from", "into", "but", "all", "any", "our", "your", "their",
]);

/** Negation tokens: their presence flips "matches a passage" into "denies a passage". */
const NEGATIONS = new Set<string>(["not", "no", "never", "cannot"]);

/** Scaffolding markers — lexical signatures of non-factual teaching moves. */
const ANALOGY_MARKERS = ["like ", "imagine", "think of", "picture "];
const NEGATIVE_FRAMING = ["what it is not", "isn't just", "not simply"];
const META_MARKERS = ["let's", "we'll", "we will"];

/** Lowercase, split on non-alphanumeric, and keep only content tokens: length >= 3
 *  and neither a stopword nor a negation token. Returns a SET (each distinct token
 *  counts once) so duplicates never skew the overlap fraction. */
function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw) || NEGATIONS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** True if the claim carries any negation token (scanned before content filtering,
 *  since short negations like "no" would otherwise be dropped by the len<3 filter). */
function hasNegation(text: string): boolean {
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (NEGATIONS.has(raw)) return true;
  }
  return false;
}

/** Best fraction of the claim's content tokens found in any single passage:
 *  max over passages of |claim ∩ passage| / |claim|. No claim content (or no
 *  passages) → 0 (nothing grounded), never NaN. */
function bestOverlap(claimContent: Set<string>, passages: string[]): number {
  if (claimContent.size === 0) return 0;
  let best = 0;
  for (const passage of passages) {
    const passageContent = contentTokens(passage);
    let hits = 0;
    for (const token of claimContent) {
      if (passageContent.has(token)) hits++;
    }
    const fraction = hits / claimContent.size;
    if (fraction > best) best = fraction;
  }
  return best;
}

/** True if the trimmed sentence is a non-factual teaching move (analogy, rhetorical
 *  question, explicit negative framing, or meta narration). */
function isScaffolding(sentence: string): boolean {
  if (sentence.endsWith("?")) return true; // rhetorical question
  const lower = sentence.toLowerCase();
  if (ANALOGY_MARKERS.some((m) => lower.includes(m))) return true;
  if (NEGATIVE_FRAMING.some((m) => lower.includes(m))) return true;
  if (META_MARKERS.some((m) => lower.includes(m))) return true;
  return false;
}

/**
 * Split prose into atomic claims by sentence, classifying each as scaffolding or
 * factual. Sentences keep their terminating punctuation (so "?" stays detectable),
 * are trimmed, and empties are dropped. Empty / punctuation-only input → [].
 */
export function extractClaims(blockText: string): Claim[] {
  const sentences = blockText.match(/[^.!?]+[.!?]*/g) ?? [];
  const claims: Claim[] = [];
  for (const raw of sentences) {
    const text = raw.trim();
    if (text.length === 0) continue;
    claims.push({ text, kind: isScaffolding(text) ? "scaffolding" : "factual" });
  }
  return claims;
}

/**
 * Grade one claim against the source passages.
 *  - Scaffolding short-circuits to SCAFFOLDING (a teaching move grounds no fact).
 *  - A negation whose NON-negation content strongly overlaps a passage means the
 *    passage asserts the very thing the claim denies → CONTRADICTED.
 *  - Otherwise: >= STRONG → SUPPORTED; >= PARTIAL → PARTIALLY_SUPPORTED; else
 *    UNSUPPORTED. Empty passages → UNSUPPORTED (nothing to ground against).
 */
export function gradeClaim(claim: Claim, passages: string[]): ClaimLabel {
  if (claim.kind === "scaffolding") return "SCAFFOLDING";

  const content = contentTokens(claim.text);
  const overlap = bestOverlap(content, passages);

  if (hasNegation(claim.text) && overlap >= STRONG_THRESHOLD) return "CONTRADICTED";
  if (overlap >= STRONG_THRESHOLD) return "SUPPORTED";
  if (overlap >= PARTIAL_THRESHOLD) return "PARTIALLY_SUPPORTED";
  return "UNSUPPORTED";
}

/**
 * Groundedness of a block: the mean support over its FACTUAL claims only
 * (SCAFFOLDING is excluded from the denominator). SUPPORTED counts 1,
 * PARTIALLY_SUPPORTED counts 0.5, everything else (UNSUPPORTED, CONTRADICTED)
 * counts 0. No factual claims → 1 (the block said nothing unfounded).
 */
export function groundedness(labels: ClaimLabel[]): number {
  const factual = labels.filter((label) => label !== "SCAFFOLDING");
  if (factual.length === 0) return 1;
  let score = 0;
  for (const label of factual) {
    if (label === "SUPPORTED") score += 1;
    else if (label === "PARTIALLY_SUPPORTED") score += 0.5;
  }
  return score / factual.length;
}

/** The release-gate outcome for a graded block. */
export type ReleaseVerdict = "RELEASE" | "WARN" | "REGENERATE" | "REJECT";

/**
 * The release rule. A SINGLE contradiction rejects the block outright, regardless
 * of groundedness (a stated falsehood is never shippable). Otherwise groundedness
 * decides: perfect (>= 1) → RELEASE; above the warn threshold → WARN; below →
 * REGENERATE.
 */
export function releaseRule(g: number, contradictedCount: number, threshold = 0.95): ReleaseVerdict {
  if (contradictedCount > 0) return "REJECT";
  if (g >= 1) return "RELEASE";
  if (g >= threshold) return "WARN";
  return "REGENERATE";
}
