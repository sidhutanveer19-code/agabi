import type { Doc } from "@/server/ingest/spans";
import type { RawSource } from "@/server/ingest/connector";
import type { DocumentHierarchy, HierarchyNode } from "@/server/ingest/discovery/types";
import { type CurriculumProfile, GENERIC_PROFILE } from "@/server/ingest/discovery/profile";

/**
 * Structural discovery (W2). Deterministic, pure, structure-only — reads the markdown heading
 * levels that survive as literal `#/##/###` text in a span, and nests them into a
 * `Document → Chapter → Section → Subsection → Topic` tree with each node's source span + page.
 *
 * NB (recorded limitation): `parseHtml` discards heading level, so HTML yields a flat hierarchy;
 * markdown — the import format — is fully covered. A future `Span.headingLevel` field would close
 * the HTML gap (a small parse enhancement, not built now).
 */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

export function buildHierarchy(doc: Doc, profile: CurriculumProfile): DocumentHierarchy {
  // Detect headings PER LINE, not per span: parseMarkdown groups consecutive non-blank lines,
  // so a heading without a blank line before it shares a span with the prose above it.
  const heads: { level: number; title: string; start: number; page: number }[] = [];
  for (const span of doc) {
    let offset = 0;
    for (const line of span.text.split("\n")) {
      const m = HEADING.exec(line.trim());
      if (m) heads.push({ level: m[1].length, title: m[2].trim(), start: span.sourceRange[0] + offset, page: span.page });
      offset += line.length + 1; // + the newline
    }
  }

  const docEnd = doc.length ? doc[doc.length - 1].sourceRange[1] : 0;
  const nodes: HierarchyNode[] = [];
  const stack: { level: number; node: HierarchyNode }[] = [];

  heads.forEach((h, i) => {
    // this heading's span runs until the next heading of equal-or-higher rank (or doc end)
    let end = docEnd;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { end = heads[j].start; break; }
    }
    const node: HierarchyNode = { level: profile.headingMap[h.level] ?? "topic", title: h.title, span: [h.start, end], page: h.page, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) nodes.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ level: h.level, node });
  });

  let subject: string | null = null;
  if (profile.subjectRules && heads.length) {
    const top = heads[0].title;
    for (const r of profile.subjectRules) {
      if (r.pattern.test(top)) { subject = r.subject; break; }
    }
  }

  return { subject, profile: profile.id, nodes };
}

/** Pick a profile for a source. Today: always generic (a source may carry a profile hint later). */
function pickProfile(_source: RawSource): CurriculumProfile {
  return GENERIC_PROFILE;
}

/** The `Discover` implementation the orchestrator uses by default. Pure + deterministic. */
export function discover(doc: Doc, source: RawSource): DocumentHierarchy {
  return buildHierarchy(doc, pickProfile(source));
}
