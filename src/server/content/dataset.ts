import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import { localFilesystemConnector } from "@/server/ingest/connectors/localFilesystem";
import { buildHierarchy } from "@/server/ingest/discovery/hierarchy";
import { getProfile, GENERIC_PROFILE } from "@/server/ingest/discovery/profile";
import { ingestSource, type IngestResult, type IngestOptions } from "@/server/content/orchestrator";
import { SOURCE_TIERS, compareTiers } from "@/server/ingest/sourcePriority";

/**
 * Content Import Specification + Curriculum Package Architecture (W5, gaps C + F). A curriculum is
 * a **dataset package** — a directory that conforms to this contract + a CurriculumProfile (a data
 * file). Installing a curriculum is `loadDataset(dir, …)` — a DATA operation, never new code. The
 * engine never names a curriculum; CBSE/JEE/NEET are packages under `/datasets/`.
 *
 * A package:
 *   datasets/{id}/
 *     manifest.json     ← this schema
 *     <source files>    ← markdown / html / json referenced by manifest.sources[].ref
 *
 * The knowledge-OBJECT contract every source yields (concept/statement/dependency/asset/item) is the
 * existing extraction schema (`knowledge/extraction/schemas.ts`) — the trust boundary is the contract.
 */
export const DatasetSourceSchema = z.object({
  ref: z.string().min(1), // path relative to the dataset dir
  format: z.enum(["markdown", "html", "json", "pdf"]).optional(),
  subject: z.string().optional(),
  chapter: z.string().optional(),
  tier: z.enum(SOURCE_TIERS).optional(), // source-priority tier — orders ingestion, highest-trust first
  hash: z.string().optional(), // content hash of the converted source (reproducibility + checkpointing)
});

/** Attribution block (§27.1) — who/where/when a package's content came from. */
export const AttributionSchema = z.object({
  author: z.string().min(1),
  sourceUrl: z.string().optional(),
  retrievalDate: z.string().optional(),
});

export const DatasetManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profile: z.string().default("generic"), // CurriculumProfile id — a data file, not engine code
  license: z.string().min(1), // the operator's licence assertion (§24, §27.1)
  version: z.string().min(1),
  attribution: AttributionSchema.optional(), // provenance for the whole package (§27.1)
  sources: z.array(DatasetSourceSchema).min(1),
});
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;

/** Validate a package's manifest against the contract (throws on any violation). */
export function loadManifest(dir: string): DatasetManifest {
  return DatasetManifestSchema.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
}

export interface DatasetResult {
  id: string;
  profile: string;
  license: string;
  sources: number;
  results: IngestResult[];
  counts: { concepts: number; statements: number; edges: number; assets: number; items: number };
}

/**
 * Install a curriculum package: validate the manifest, then drive every source through the
 * orchestrator (W1) under the package's declared profile. Continues source by source; append-only,
 * everything MACHINE_PROPOSED. This is the whole "process an entire curriculum" operation — data in,
 * proposals out — with no engine change per curriculum.
 */
export async function loadDataset(dir: string, store: KnowledgeStore, invoke: JsonInvoke, opts: IngestOptions = {}): Promise<DatasetResult> {
  const manifest = loadManifest(dir);
  const profile = getProfile(manifest.profile) ?? GENERIC_PROFILE;
  const discover = (doc: Parameters<typeof buildHierarchy>[0]) => buildHierarchy(doc, profile);

  // Highest-trust sources first (source priority). Stable: equal tiers keep manifest order.
  const ordered = manifest.sources.map((s, i) => ({ s, i })).sort((a, b) => compareTiers(a.s.tier, b.s.tier) || a.i - b.i).map((x) => x.s);

  const results: IngestResult[] = [];
  for (const src of ordered) {
    const connector = localFilesystemConnector({ license: manifest.license });
    results.push(await ingestSource(store, connector, join(dir, src.ref), invoke, { ...opts, format: src.format, discover }));
  }

  const sum = (pick: (r: IngestResult) => number) => results.reduce((n, r) => n + pick(r), 0);
  return {
    id: manifest.id,
    profile: manifest.profile,
    license: manifest.license,
    sources: manifest.sources.length,
    results,
    counts: {
      concepts: sum((r) => r.counts.concepts),
      statements: sum((r) => r.counts.statements),
      edges: sum((r) => r.counts.edges),
      assets: sum((r) => r.counts.assets),
      items: sum((r) => r.counts.items),
    },
  };
}
