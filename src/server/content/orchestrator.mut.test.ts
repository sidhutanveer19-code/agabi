import { describe, it, expect, vi } from "vitest";

// The orchestrator emits one evidence event per stage; in a node test there is no DB, so emit is
// stubbed. Unlike orchestrator.test.ts we KEEP the vi.fn so its call log can be asserted (the
// per-stage payload ObjectLiterals + the actorId/origin arguments are only observable here).
vi.mock("@/server/events", async (orig) => {
  const actual = await orig<typeof import("@/server/events")>();
  return { ...actual, emit: vi.fn(async () => "evt"), emitMany: vi.fn(async () => []) };
});

import { ingestSource } from "@/server/content/orchestrator";
import { emit, EVENTS } from "@/server/events";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { POLICIES } from "@/server/knowledge/trust/policy";
import { sha256 } from "@/server/knowledge/ids";
import type { SourceConnector, RawSource } from "@/server/ingest/connector";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";
import type { Scope } from "@/server/knowledge/types";
import type { DimensionRegistry } from "@/server/knowledge/context/registry";

// ── Fixtures — synthetic, public-domain; they prove the FACTORY, never content. ──
const URI = "file:///photosynthesis.md";
const MD = ["# Photosynthesis", "", "Chlorophyll absorbs light in the visible spectrum. Photosynthesis requires light to occur.", ""].join("\n");
const HTML = "<h1>Photosynthesis</h1><p>Chlorophyll absorbs light in the visible spectrum. Photosynthesis requires light to occur.</p>";
const JSON_SRC = JSON.stringify({ title: "Photosynthesis", blocks: [{ level: 1, heading: "Photosynthesis", text: "Chlorophyll absorbs light in the visible spectrum. Photosynthesis requires light to occur." }] });

type Bundle = Record<string, unknown>;

// The bundle the standard fake returns — every extractor reads only its own key.
const FIXTURE: Bundle = {
  entities: [{ name: "Chlorophyll" }, { name: "Light" }, { name: "Photosynthesis" }],
  statements: [{ form: "SPO", kind: "FACT", text: "Chlorophyll captures light within the visible range.", quote: "Chlorophyll absorbs light in the visible spectrum", structure: {}, subject: "Chlorophyll", predicate: "absorbs", object: "Light" }],
  dependencies: [{ fromName: "Photosynthesis", toName: "Light", classification: "REQUIRES" }],
  assets: [],
  items: [],
};

const invokeReturning = (data: Bundle): JsonInvoke => async () => ({ raw: JSON.stringify(data), data });
const fakeInvoke = invokeReturning(FIXTURE);

interface ConnOpts {
  uri?: string | null; // null → the source omits `uri` entirely
  title?: string;
  bytes?: Buffer;
  license?: string;
  licenseUrl?: string;
  requiresApproval?: boolean;
  permitted?: boolean;
}
function makeConnector(o: ConnOpts = {}): SourceConnector {
  return {
    id: "test-fixture",
    kinds: ["book"],
    async license() {
      return { permitted: o.permitted ?? true, license: o.license ?? "CC0-1.0", requiresApproval: o.requiresApproval ?? false };
    },
    async fetch() {
      const source: RawSource = {
        kind: "book",
        title: o.title ?? "photosynthesis.md",
        publisher: "public-domain",
        authority: "test",
        license: o.license ?? "CC0-1.0",
        ...(o.uri === null ? {} : { uri: o.uri ?? URI }),
        ...(o.licenseUrl !== undefined ? { licenseUrl: o.licenseUrl } : {}),
      };
      return { source, bytes: o.bytes ?? Buffer.from(MD, "utf8") };
    },
  };
}
const stdConnector = makeConnector();

// ─────────────────────────────────────────────────────────────────────────────
// detectFormat (L120–127): override wins; extension → format; case-folded; uri ?? title.
// ─────────────────────────────────────────────────────────────────────────────
describe("detectFormat", () => {
  it("honours an explicit format override over the uri extension (L121 `if (override)`)", async () => {
    // uri says .html; override says markdown → markdown must win (and parse cleanly as markdown).
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: "file:///doc.html", bytes: Buffer.from(MD, "utf8") }), "doc", fakeInvoke, { modelId: "fake", format: "markdown" });
    expect(r.format).toBe("markdown");
  });

  it("detects .html → html and returns exactly \"html\" (L123 branch + string)", async () => {
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: "file:///doc.html", bytes: Buffer.from(HTML, "utf8") }), "doc", fakeInvoke, { modelId: "fake" });
    expect(r.format).toBe("html");
  });

  it("detects .htm → html — the RIGHT operand of the || alone (L123 `||`, endsWith)", async () => {
    // ".htm" ends with ".htm" but NOT ".html", so only the second endsWith is true. `&&` would miss it.
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: "file:///doc.htm", bytes: Buffer.from(HTML, "utf8") }), "doc", fakeInvoke, { modelId: "fake" });
    expect(r.format).toBe("html");
  });

  it("lower-cases the uri before matching (L122 `.toLowerCase()`)", async () => {
    // Uppercase extension only matches after toLowerCase; without it → falls through to markdown.
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: "file:///DOC.HTML", bytes: Buffer.from(HTML, "utf8") }), "doc", fakeInvoke, { modelId: "fake" });
    expect(r.format).toBe("html");
  });

  it("falls back to the TITLE extension when there is no uri (L122 `source.uri ?? source.title`)", async () => {
    // No uri at all; the title carries the extension. `&&` would give undefined → toLowerCase throws.
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: null, title: "doc.html", bytes: Buffer.from(HTML, "utf8") }), "doc", fakeInvoke, { modelId: "fake" });
    expect(r.format).toBe("html");
  });

  it("detects .json → json and returns exactly \"json\" (L124)", async () => {
    const r = await ingestSource(createMemoryStore(), makeConnector({ uri: "file:///doc.json", bytes: Buffer.from(JSON_SRC, "utf8") }), "doc", fakeInvoke, { modelId: "fake" });
    expect(r.format).toBe("json");
  });

  it("detects .pdf → routes to the pdf slot, which throws E8 (L125)", async () => {
    // A mutated pdf branch either falls through to markdown (no throw) or yields "" (a different
    // "no parser" error) — only the real branch produces the E8 deferred-dependency message.
    await expect(
      ingestSource(createMemoryStore(), makeConnector({ uri: "file:///doc.pdf", bytes: Buffer.from(MD, "utf8") }), "doc", fakeInvoke, { modelId: "fake" }),
    ).rejects.toThrow(/PDF parsing needs a parser dependency/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sourceId (L162): "src_" + sha256(uri).slice(0,24).
// ─────────────────────────────────────────────────────────────────────────────
it("mints sourceId as \"src_\" + first 24 hex of sha256(uri) (L162 prefix/slice/`??`)", async () => {
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
  expect(r.sourceId).toBe("src_" + sha256(URI).slice(0, 24));
  expect(r.sourceId).toHaveLength(28); // "src_" (4) + 24 hex — slice must not be dropped
  expect(r.sourceId.startsWith("src_")).toBe(true);
  // uri, not title, seeds the hash: `uri && title` would hash the title and differ.
  expect(r.sourceId).not.toBe("src_" + sha256("photosynthesis.md").slice(0, 24));
});

// ─────────────────────────────────────────────────────────────────────────────
// emit: actorId (L153), origin "server" (L158), and one populated payload per stage
// (L164/168/170/172/192/197/248 + validated/enqueued/omitted).
// ─────────────────────────────────────────────────────────────────────────────
it("emits every stage with actorId \"system:ingest\", origin \"server\" and a POPULATED payload", async () => {
  vi.mocked(emit).mockClear();
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
  const calls = vi.mocked(emit).mock.calls;
  const payload = (type: string) => (calls.find((c) => c[1] === type)?.[2] ?? undefined) as Record<string, unknown> | undefined;

  // The stages ledger starts EMPTY — a seeded `["Stryker was here"]` would sit at index 0.
  expect(r.stages[0]).toBe("ingest.acquired");
  expect(r.stages).not.toContain("Stryker was here");

  // actorId defaulted, origin fixed — on EVERY call.
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c[0] === "system:ingest")).toBe(true); // L153 default string
  expect(calls.every((c) => c[3] === "server")).toBe(true); // L158 origin string

  const acquired = payload(EVENTS.ingestAcquired)!;
  expect(acquired.sourceId).toBe(r.sourceId);
  expect(acquired.uri).toBe(URI);
  expect(acquired.license).toBe("CC0-1.0");
  expect(acquired.format).toBe("markdown");

  expect(payload(EVENTS.ingestParsed)!.sourceId).toBe(r.sourceId);
  expect(typeof payload(EVENTS.ingestParsed)!.spans).toBe("number");
  expect(payload(EVENTS.ingestNormalised)!.sourceId).toBe(r.sourceId);
  expect(typeof payload(EVENTS.ingestNormalised)!.spans).toBe("number");
  expect(payload(EVENTS.ingestChunked)!.chunks).toBe(r.chunks.length);
  expect(payload(EVENTS.ingestChunksPersisted)!.chunks).toBe(r.chunks.length);

  const discovered = payload(EVENTS.ingestDiscovered)!;
  expect(discovered.profile).toBe("generic");
  expect(typeof discovered.nodes).toBe("number");
  expect(typeof discovered.textLength).toBe("number");

  const extracted = payload(EVENTS.ingestExtracted)!;
  expect(extracted.sourceId).toBe(r.sourceId);
  expect(typeof extracted.chunkId).toBe("string");
  expect(typeof extracted.entities).toBe("number");
  expect(typeof extracted.statements).toBe("number");

  const validated = payload(EVENTS.ingestValidated)!;
  expect(typeof validated.persisted).toBe("number");
  expect(typeof validated.rejected).toBe("number");

  expect(typeof payload(EVENTS.ingestEnqueued)!.concepts).toBe("number");
  expect(typeof payload(EVENTS.ingestOmitted)!.total).toBe("number");
});

it("passes the caller's actorId through to emit unchanged (L153 `opts.actorId ??`)", async () => {
  vi.mocked(emit).mockClear();
  await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake", actorId: "operator:jane" });
  const calls = vi.mocked(emit).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c[0] === "operator:jane")).toBe(true); // `&&` would substitute "system:ingest"
});

// ─────────────────────────────────────────────────────────────────────────────
// putSource: uri and licenseUrl are the real values, not null (L185/L188 `?? null`).
// ─────────────────────────────────────────────────────────────────────────────
it("persists the source uri and licenseUrl verbatim, not null (L185/L188)", async () => {
  const store = createMemoryStore();
  const connector = makeConnector({ uri: URI, licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" });
  const r = await ingestSource(store, connector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
  const src = await store.getSource(r.sourceId);
  expect(src?.uri).toBe(URI); // `uri && null` → null
  expect(src?.licenseUrl).toBe("https://creativecommons.org/publicdomain/zero/1.0/"); // `licenseUrl && null` → null
});

// ─────────────────────────────────────────────────────────────────────────────
// modelId stamped into provenance (L200 `opts.modelId ?? "unknown"`).
// ─────────────────────────────────────────────────────────────────────────────
async function provModelId(opts: { modelId?: string }): Promise<string | undefined> {
  const store = createMemoryStore();
  await ingestSource(store, stdConnector, "photosynthesis.md", fakeInvoke, opts);
  const subject = await store.resolveSlug("chlorophyll", "PUBLIC");
  if (subject.kind !== "concept") throw new Error("subject concept not created");
  const stmts = await store.statementsForSubject(subject.conceptId, "PUBLIC", POLICIES.RND);
  const prov = await store.provenanceFor(stmts[0].id);
  return prov[0]?.modelId;
}
it("defaults provenance modelId to \"unknown\" when none is given, and uses the given one otherwise (L200)", async () => {
  expect(await provModelId({})).toBe("unknown"); // "unknown" → "" would break this
  expect(await provModelId({ modelId: "qwen2.5:7b" })).toBe("qwen2.5:7b"); // `&&` → "unknown"
});

// ─────────────────────────────────────────────────────────────────────────────
// scope threaded through everything (L154 `opts.scope ?? "PUBLIC"`).
// ─────────────────────────────────────────────────────────────────────────────
it("creates everything under the caller's scope, not PUBLIC (L154 `opts.scope ??`)", async () => {
  const scope: Scope = "tenant:acme";
  const store = createMemoryStore();
  const r = await ingestSource(store, stdConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake", scope });
  expect(r.counts.concepts).toBeGreaterThanOrEqual(3);
  // Found under the tenant scope…
  expect((await store.resolveSlug("chlorophyll", scope)).kind).toBe("concept");
  // …and INVISIBLE under PUBLIC. `opts.scope && "PUBLIC"` would have written it as PUBLIC (visible here).
  expect((await store.resolveSlug("chlorophyll", "PUBLIC")).kind).not.toBe("concept");
});

// ─────────────────────────────────────────────────────────────────────────────
// registry threaded into validateStatement (L155 `opts.registry ?? {}`).
// ─────────────────────────────────────────────────────────────────────────────
it("uses the supplied dimension registry so a registered context validates (L155 `opts.registry ??`)", async () => {
  const grounded: Bundle = {
    entities: [{ name: "Chlorophyll" }],
    statements: [{ form: "DEFINITIONAL", kind: "DEFINITION", text: "A light-absorbing pigment.", quote: "Chlorophyll absorbs light in the visible spectrum", structure: { subject: "Chlorophyll" }, contextDimensions: { region: "IN" } }],
    dependencies: [], assets: [], items: [],
  };
  const registry: DimensionRegistry = { region: { key: "region", valueType: "string", values: [], specificity: 1, appliesTo: [], since: "2020-01-01" } };

  // With the registry, "region" is registered → V11 passes → the statement is persisted.
  const withReg = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(grounded), { modelId: "fake", registry });
  expect(withReg.counts.statements).toBe(1);
  expect(withReg.counts.statementsRejected).toBe(0);
  expect(withReg.counts.chunkFailures).toBe(0);

  // Without it (default {}), the very same dimension is unregistered → V11 discards it. This proves
  // the registry is actually consulted; `opts.registry && {}` would pass undefined and throw instead.
  const noReg = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(grounded), { modelId: "fake" });
  expect(noReg.counts.statements).toBe(0);
  expect(noReg.counts.statementsRejected).toBe(1);
  expect(noReg.omissions.find((o) => o.kind === "statement-rejected")?.reason).toContain("UNREGISTERED_DIMENSION_region");
});

// ─────────────────────────────────────────────────────────────────────────────
// hint init + entity names threaded into the prompts (L222 `hint = ""`, L241 names map).
// ─────────────────────────────────────────────────────────────────────────────
it("threads an empty hint and the real entity names into the extractor prompts (L222/L241)", async () => {
  const seen: { system: string; user: string }[] = [];
  const capturing: JsonInvoke = async (system, user) => { seen.push({ system, user }); return { raw: JSON.stringify(FIXTURE), data: FIXTURE }; };
  await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", capturing, { modelId: "fake" });

  // classifyParagraphs is off → hint stays "". A mutated `hint = "Stryker was here!"` would ride
  // into the entity/statement prompts, which embed the hint verbatim.
  expect(seen.every((c) => !c.system.includes("Stryker was here!"))).toBe(true);
  // The resolved names reach the statement/dependency/asset/item prompts. `() => undefined` would
  // make them all undefined → the joined list would be empty.
  expect(seen.some((c) => c.system.includes("Known concepts: Chlorophyll, Light, Photosynthesis"))).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// failedGates + gateDetail (L98–L103): exact reason string + exact gate objects.
// ─────────────────────────────────────────────────────────────────────────────
it("names EVERY failing gate (and only failing gates) in the reason and gate detail (L98–L103)", async () => {
  // A statement that fails V2 (unknown kind) AND V3 (quote absent) and nothing else — two gates,
  // so the "; " join is exercised and passing gates must be excluded.
  const twoBad: Bundle = {
    entities: [{ name: "Light" }],
    statements: [{ form: "DEFINITIONAL", kind: "MYTH", text: "A short own-words claim.", quote: "This exact phrase is definitely absent here", structure: {} }],
    dependencies: [], assets: [], items: [],
  };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(twoBad), { modelId: "fake" });
  const rej = r.omissions.find((o) => o.kind === "statement-rejected");
  // Exact: order preserved (V2 before V3), "; " separator, "validator:outcome — reason" per gate,
  // and NO passing gate (V4/V5/V11/V12/V15) leaks in.
  expect(rej?.reason).toBe("V2:discard — UNKNOWN_KIND_MYTH; V3:discard — QUOTE_NOT_IN_SOURCE");
  // gateDetail — the structured twin — must be exactly these two objects, each carrying its reason.
  expect(rej?.data?.gates).toEqual([
    { validator: "V2", outcome: "discard", reason: "UNKNOWN_KIND_MYTH" },
    { validator: "V3", outcome: "discard", reason: "QUOTE_NOT_IN_SOURCE" },
  ]);
  // The chunk yielded one proposal, all rejected → the "all N rejected" barren branch (not the
  // "proposed no statements" branch).
  expect(r.omissions.find((o) => o.kind === "barren-chunk")?.reason).toBe("all 1 proposed statement(s) were rejected by validation gates");
});

// ─────────────────────────────────────────────────────────────────────────────
// acceptArray element-discard: fields + per-extractor label (L142/L143/L145 + labels).
// ─────────────────────────────────────────────────────────────────────────────
it("records an element-discard per extractor with the extractor label, index and reason (L142/L143/L145)", async () => {
  const malformed: Bundle = {
    entities: [{ name: "Chlorophyll" }, { name: "" }], // "" fails min(1) → element-discard "entities"
    statements: [
      { form: "HISTORICAL", kind: "FACT", text: "x", quote: "Chlorophyll absorbs light", structure: { subject: "Chlorophyll" } }, // invented form → "statements"
      { form: "DEFINITIONAL", kind: "DEFINITION", text: "A pigment that takes in light.", quote: "Chlorophyll absorbs light", structure: { subject: "Chlorophyll" } },
    ],
    dependencies: [{ fromName: "A", toName: "B", classification: "BOGUS" }], // bad enum → "dependencies"
    assets: [{ kind: "NOTAKIND", conceptName: "Chlorophyll", payload: {} }], // bad enum → "assets"
    items: [{ kind: "NOTANITEM", conceptName: "Chlorophyll", prompt: "p", payload: {} }], // bad enum → "items"
  };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(malformed), { modelId: "fake" });
  const discards = r.omissions.filter((o) => o.kind === "element-discard");

  const stmt = discards.find((o) => o.data?.extractor === "statements")!;
  expect(stmt.stage).toBe("accept"); // L142 stage string
  expect(stmt.kind).toBe("element-discard"); // L143 ternary (index >= 0)
  expect(stmt.data?.index).toBe(0);
  expect(stmt.data?.zodPath).toBe("form");
  expect(String(stmt.data?.preview)).toContain("HISTORICAL");
  // L145 reason template: "<extractor>[<index>]: <code> at <path> — <message>".
  expect(stmt.reason.startsWith("statements[0]: ")).toBe(true);
  expect(stmt.reason).toContain(" at form ");
  expect(stmt.reason).toContain(" — ");

  // Each extractor stamps its OWN label — the ac("…") string literals.
  expect(discards.map((o) => o.data?.extractor).sort()).toEqual(["assets", "dependencies", "entities", "items", "statements"]);
});

it("records a batch-discard (index -1) when a whole extractor payload is not an array (L143 batch branch)", async () => {
  const notArray: Bundle = { entities: "not an array", statements: [], dependencies: [], assets: [], items: [] };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(notArray), { modelId: "fake" });
  const batch = r.omissions.find((o) => o.kind === "batch-discard");
  expect(batch).toBeDefined();
  expect(batch?.stage).toBe("accept");
  expect(batch?.kind).toBe("batch-discard"); // L143: index < 0 → "batch-discard", not "element-discard"
  expect(batch?.data?.index).toBe(-1);
  expect(batch?.data?.extractor).toBe("entities");
  expect(batch?.reason).toBe("entities[-1]: not_an_array at (root) — expected an array, got string");
  // No statements proposed at all → the OTHER barren branch.
  expect(r.omissions.find((o) => o.kind === "barren-chunk")?.reason).toContain("extraction proposed no statements for this chunk");
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyParagraphs branch (L222/L223/L228–L234) — fully NoCoverage until now.
// ─────────────────────────────────────────────────────────────────────────────
it("classifies paragraphs and reports the unlabelled ones as an omission (L223/L228/L229–L234)", async () => {
  // The model returns no labels → every paragraph is unlabelled (unlabelled > 0, invalid === 0),
  // so the `||` branch fires and one omission is pushed.
  const data: Bundle = { paragraphs: [], entities: [{ name: "Chlorophyll" }], statements: [], dependencies: [], assets: [], items: [] };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(data), { modelId: "fake", classifyParagraphs: true });

  const om = r.omissions.find((o) => o.kind === "element-discard" && o.data?.extractor === "classification");
  expect(om).toBeDefined(); // block ran (L223 not skipped/emptied) AND the branch fired (L228 not ->false/&&)
  expect(om?.stage).toBe("accept"); // L230
  expect(om?.kind).toBe("element-discard"); // L231
  // L233 reason template.
  expect(om?.reason.startsWith("classification: ")).toBe(true);
  expect(om?.reason).toContain("paragraph(s) unlabelled");
  expect(om?.reason).toContain("with a label outside the vocabulary");
  expect(om?.reason).toContain("those paragraphs contribute no hint");
  // L234 data object.
  expect(om?.data?.extractor).toBe("classification");
  expect(om?.data?.invalid).toEqual([]);
  expect(Array.isArray(om?.data?.unlabelled)).toBe(true);
  expect((om?.data?.unlabelled as number[]).length).toBeGreaterThan(0);
  expect(om?.data?.paragraphs).toBe((om?.data?.unlabelled as number[]).length); // every paragraph unlabelled
});

it("pushes NO classification omission when every paragraph is validly labelled (L228 ->true)", async () => {
  // A valid label for every conceivable index → nothing unlabelled, nothing invalid → no omission.
  const labels = Array.from({ length: 100 }, (_, i) => ({ index: i, label: "CANONICAL" }));
  const data: Bundle = { paragraphs: labels, entities: [{ name: "Chlorophyll" }], statements: [], dependencies: [], assets: [], items: [] };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(data), { modelId: "fake", classifyParagraphs: true });
  expect(r.omissions.some((o) => o.data?.extractor === "classification")).toBe(false); // `if (...)` ->true would push anyway
});

// ─────────────────────────────────────────────────────────────────────────────
// acquire approval gate (L161 `{ approveUnknown: opts.approveUnknown }`).
// ─────────────────────────────────────────────────────────────────────────────
it("forwards approveUnknown so an unknown-licence source proceeds only when approved (L161)", async () => {
  const connector = makeConnector({ requiresApproval: true });
  // Refused without approval…
  await expect(ingestSource(createMemoryStore(), connector, "ref", fakeInvoke, { modelId: "fake" })).rejects.toThrow(/refused/);
  // …and proceeds WITH it. `{}` would drop the flag → this would throw instead of resolving.
  const r = await ingestSource(createMemoryStore(), connector, "ref", fakeInvoke, { modelId: "fake", approveUnknown: true });
  expect(r.sourceId.startsWith("src_")).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// dependency loop body + validation context (L264/L267) and the graph-array pushes (L274/L275).
// ─────────────────────────────────────────────────────────────────────────────
it("validates and persists a dependency through a populated context (L264 body, L267 ctx)", async () => {
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", fakeInvoke, { modelId: "fake" });
  expect(r.counts.edges).toBe(1); // the one REQUIRES edge — an emptied loop body persists nothing
  expect(r.counts.dependenciesRejected).toBe(0);
  expect(r.counts.chunkFailures).toBe(0); // a `{}` ctx makes v7 dereference undefined and throw
});

it("threads the newly-accepted PART_OF edge into the local composition set so a reverse PART_OF is a cycle (L275)", async () => {
  const bundle: Bundle = {
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    statements: [],
    dependencies: [
      { fromName: "Alpha", toName: "Beta", classification: "PART_OF" }, // pushed to compEdges
      { fromName: "Beta", toName: "Alpha", classification: "PART_OF" }, // now closes a composition cycle → V8 rejects
    ],
    assets: [], items: [],
  };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(bundle), { modelId: "fake" });
  // Real: first persists (edges=1), second is rejected as a cycle. Any of ->false / !== / ""/{}
  // fails to record the first edge, so the second no longer cycles → both persist (edges=2, rej=0).
  expect(r.counts.edges).toBe(1);
  expect(r.counts.dependenciesRejected).toBe(1);
  expect(r.omissions.find((o) => o.kind === "dependency-rejected")?.reason).toContain("WOULD_CLOSE_COMPOSITION_CYCLE");
});

it("does NOT treat a REINFORCEMENT edge as PART_OF — a later PART_OF still validates (L275 ->true / === )", async () => {
  const bundle: Bundle = {
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    statements: [],
    dependencies: [
      { fromName: "Alpha", toName: "Beta", classification: "REINFORCEMENT" }, // must NOT enter compEdges
      { fromName: "Beta", toName: "Alpha", classification: "PART_OF" }, // legal — no composition cycle exists
    ],
    assets: [], items: [],
  };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(bundle), { modelId: "fake" });
  // `else if (true)` (or `!== "PART_OF"`) would wrongly push the REINFORCEMENT pair into compEdges,
  // turning the later PART_OF into a false cycle.
  expect(r.counts.edges).toBe(2);
  expect(r.counts.dependenciesRejected).toBe(0);
});

it("threads the newly-accepted REQUIRES edge into the local dependency set so a reverse REQUIRES is a cycle (L274)", async () => {
  const bundle: Bundle = {
    entities: [{ name: "Alpha" }, { name: "Beta" }],
    statements: [],
    dependencies: [
      { fromName: "Alpha", toName: "Beta", classification: "REQUIRES" },
      { fromName: "Beta", toName: "Alpha", classification: "REQUIRES" }, // closes a dependency cycle → V7 rejects
    ],
    assets: [], items: [],
  };
  const r = await ingestSource(createMemoryStore(), stdConnector, "photosynthesis.md", invokeReturning(bundle), { modelId: "fake" });
  expect(r.counts.edges).toBe(1);
  expect(r.counts.dependenciesRejected).toBe(1);
  expect(r.omissions.find((o) => o.kind === "dependency-rejected")?.reason).toContain("WOULD_CLOSE_DEPENDENCY_CYCLE");
});
