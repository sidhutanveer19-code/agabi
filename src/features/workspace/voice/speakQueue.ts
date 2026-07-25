/**
 * Pure speak-selection logic, extracted OUT of the browser hook so it is testable (§H1.7 — don't leave
 * the logic trapped behind React/store I/O). Decides WHICH text to read aloud, so the two real bugs are
 * guarded by tests: (A) never blurt the whole existing lesson when the mic turns on — everything already
 * on the canvas is baseline; (B) only speak a block once it has settled, not a mid-stream fragment.
 */
export interface Speakable {
  id: string;
  text: string;
}
interface RegionLike {
  blocks: { id: string; data: unknown }[];
}

/** All text-bearing blocks currently on the canvas (a block's spoken text lives in `data.text`). */
export function collectSpeakable(regions: RegionLike[]): Speakable[] {
  const out: Speakable[] = [];
  for (const r of regions) {
    for (const b of r.blocks) {
      const text = (b.data as { text?: unknown } | undefined)?.text;
      if (typeof text === "string" && text.trim()) out.push({ id: b.id, text: text.trim() });
    }
  }
  return out;
}

/**
 * The NEW speakables to read aloud: those whose id isn't already handled. Marks them seen. NO settling
 * heuristic — the CALLER only invokes this once the lesson has STOPPED streaming (settled), so every
 * block here holds its complete, final text. This fixes red-team F3 (headings / "x = 5" and any block
 * not ending in punctuation were silently skipped) and F4 (only the first mid-stream snapshot was
 * spoken). Baseline (F-A) is set by the caller pre-loading `seen` with the ids already on the canvas.
 */
export function newToSpeak(current: Speakable[], seen: Set<string>): Speakable[] {
  const fresh: Speakable[] = [];
  for (const s of current) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    fresh.push(s);
  }
  return fresh;
}
