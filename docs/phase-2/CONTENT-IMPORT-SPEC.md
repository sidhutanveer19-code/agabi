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
