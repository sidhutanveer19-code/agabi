import type { Doc } from "@/server/ingest/spans";

/**
 * PDF → Doc — the ONE deferred dependency (E8, G6). Real PDF parsing needs a parser
 * library, and adding an npm dependency is a stop-and-ask. Until that decision is made
 * this is a typed stub that throws loudly rather than silently returning an empty Doc —
 * a silent empty parse would look like "this PDF has no content" and quietly drop a whole
 * source. NCERT PDFs (§24) route through here, so this is the gate to open first for them.
 */
export function parsePdf(_bytes: Buffer, _page?: number): Doc {
  throw new Error(
    "PDF parsing needs a parser dependency (E8, deferred). Adding one is a stop-and-ask (G6); " +
      "until then, ingest PDFs as extracted markdown/HTML text via the local-filesystem connector.",
  );
}
