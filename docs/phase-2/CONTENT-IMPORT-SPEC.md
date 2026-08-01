# Content Import Specification & Curriculum Package Architecture (W5)

The contract every curriculum follows. A curriculum is a **dataset package** — a directory + a
`CurriculumProfile` (a data file). Installing one is `loadDataset(dir, store, invoke)` — a **data
operation, never new code**. The engine never names a curriculum; CBSE / JEE / NEET live under
`/datasets/`.

## Package layout
```
datasets/{id}/
  manifest.json        # the contract below
  <source files>       # markdown / html / json referenced by manifest.sources[].ref
```

## `manifest.json` (`DatasetManifestSchema`, zod-validated)
```jsonc
{
  "id": "sample-science",              // unique package id
  "name": "…",                          // human name
  "profile": "generic",                 // CurriculumProfile id — a DATA file (W2), never engine code
  "license": "CC0-1.0",                 // operator's licence assertion (§24, §27.1) — the front-door gate
  "version": "1.0.0",
  "sources": [                          // ≥1
    { "ref": "chapters/cells.md", "format": "markdown", "subject": "Science", "chapter": "The Cell" }
  ]
}
```
`format` is optional (detected from the extension). Any violation throws at load — a malformed package
never half-ingests.

## The knowledge-object contract
A source yields concepts / statements / dependencies / assets / items — and the object shapes are the
**existing extraction schemas** (`knowledge/extraction/schemas.ts`): the trust boundary IS the import
contract. There is no second, parallel schema to drift. A source can only propose (MACHINE_PROPOSED);
promotion is human review (§26.2).

## `loadDataset(dir, store, invoke, opts)`
Validates the manifest → for each source, builds a `local-filesystem` connector (asserting the
manifest licence) and drives it through the orchestrator (W1) under the package's declared profile
(W2). Continues source by source, append-only, everything MACHINE_PROPOSED. Returns per-source
`IngestResult[]` + aggregate `counts`. **This is the whole "process a curriculum" operation** — data
in, review-queue proposals out, zero engine change per curriculum.

## Proven
`content/dataset.test.ts` (3): validates + installs the committed `datasets/sample-science` package
(discovery reads its real chapter structure), rejects a malformed manifest, and installs a brand-new
temp curriculum with **no code change** — the DoD's "adding a second curriculum = a dir + profile".

## Adding CBSE (when licensed content exists)
1. Convert chapters to markdown/html/json (PDF needs the pdf-plugin slot — CONNECTORS.md).
2. Author a `profiles/cbse-classX.ts` profile (heading map + subject rules) and register it.
3. Drop `datasets/cbse-classX/` (manifest + sources) and run `loadDataset`. No engine change.

---

## Moving a populated graph between machines — the Knowledge Package

A dataset package is *input* (source text). A **Knowledge Package** is *output*: the populated graph,
with everything needed to restore and re-verify it elsewhere. Built by
`npm run export:knowledge -- <out-dir> [dataset-dir]`.

```
Agabi-Knowledge-v1/
├── manifest.json     format, git sha, prisma-schema hash, prompt version, model ids,
│                     row counts, per-file SHA-256
├── graph/            concepts · aliases · tags · contexts · statements · all three edge tables ·
│                     teaching assets · assessment items · item links · curriculum · releases ·
│                     review events                                       (NDJSON, sorted by id)
├── provenance/       provenance rows + the Source and SourceChunk they resolve to
├── dataset/          the canonical markdown corpus + licence/attribution manifest (NOT the PDFs)
├── docs/             architecture, pipeline, this spec, extension guide, AMENDMENTS, RESTORE.md
├── scripts/          import-knowledge · verify-graph · verify-roundtrip · review-export/submit/cli
├── reports/          verification.json · population-run.json · dataset-build.json
└── HASHES.txt        SHA-256 of every file
```

### Why provenance travels with it

Because `Source` and `SourceChunk` rows are in the package, grounding is **re-verifiable on the
target machine without the original PDFs**: `npm run sample` re-runs V3/V4/V5 against the stored
passage, and the review CLI can show the source pane. A package that shipped only statements would
restore assertions no one could check.

### Determinism and identity

`mintId()` is time + randomness by design, so ids can never be *re-derived* on the target. Instead:

- **Export is canonical** — rows sorted by id, object keys sorted recursively, Dates as ISO. Two
  exports of the same state are byte-identical.
- **Import is id-preserving** — every id is re-inserted verbatim, never re-minted. The restored graph
  is *identical*, not merely isomorphic, which is what makes "it matched" checkable.

### Restore, and proving the restore

```bash
npm ci && createdb agabi && npx prisma db push
psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
npm run import:knowledge -- <package-dir>     # refuses on a schema-hash or file-hash mismatch
npm run verify:graph -- <package-dir>/dataset
npm run verify:roundtrip -- <package-dir>     # export → temp DB → import → diff, table by table
```

Ollama is **not** needed to restore — only to extend the graph with new content.

`verify:roundtrip` creates and drops a timestamped temporary database and touches nothing else. The
knowledge store still has no delete method (`no-delete`, ADR-5); the temp database is dropped with an
admin command outside the store.
