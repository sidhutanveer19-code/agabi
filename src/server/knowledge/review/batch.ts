import type { RawStatement } from "@/server/knowledge/extraction/types";
import type { ValidationResult } from "@/server/knowledge/validators/types";
import { groundQuote, n } from "@/server/knowledge/validators/grounding";

/**
 * The batch review screen (§25.2). Three properties make review fast enough to matter
 * (~200/hr vs ~60/hr): the source passage is read ONCE for eight decisions; verification
 * is by COMPARISON (the quote is highlighted in place, using V3's char range) rather than
 * recall; and the common case — extraction is mostly right — is a single approve-all
 * keystroke. A reviewer judges at most ~8 items per screen (§25.4).
 */
export const SCREEN_SIZE = 8;

export interface ReviewProposal {
  targetKind: string;
  targetId: string;
  statement: RawStatement;
  chunkText: string; // the source pane
  validation: ValidationResult[];
}

export interface BatchScreen {
  proposals: ReviewProposal[]; // ≤ SCREEN_SIZE
}

/** Split proposals into screens of at most SCREEN_SIZE (§25.2 / §25.4). */
export function buildScreens(proposals: ReviewProposal[], size = SCREEN_SIZE): BatchScreen[] {
  const screens: BatchScreen[] = [];
  for (let i = 0; i < proposals.length; i += size) {
    screens.push({ proposals: proposals.slice(i, i + size) });
  }
  return screens;
}

/**
 * The highlighted source pane: the passage split around the grounded quote so a CLI/UI can
 * render before / <quote> / after. Uses V3's exact-containment range (§25.2) — the same
 * mechanism that makes grounding checkable makes review ergonomic. Falls back to no
 * highlight when the quote does not ground (which V3 would already have discarded).
 */
export interface HighlightedSource {
  before: string;
  quote: string;
  after: string;
  grounded: boolean;
}

export function highlightSource(chunkText: string, quote: string): HighlightedSource {
  const g = groundQuote(chunkText, quote);
  if (!g.grounded || !g.range) return { before: chunkText, quote: "", after: "", grounded: false };
  // The range is in NORMALISED space; map by re-finding the normalised quote for display.
  const normChunk = n(chunkText);
  const [start, end] = g.range;
  return { before: normChunk.slice(0, start), quote: normChunk.slice(start, end), after: normChunk.slice(end), grounded: true };
}
