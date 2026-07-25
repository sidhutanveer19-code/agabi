# Implementation Blueprint — MVP-1: Non-generic NCERT teaching

Status: **active** · Governs: the MVP build · Obeys: [CLAUDE.md](../../CLAUDE.md) §F–§M and the frozen
architecture in `docs/phase-2/FINAL/`. Requires amendment **A-7** (source-retrieval grounding).

## Goal
Answer any CBSE Class-10 topic in a way that feels **worth paying for on day 1**: grounded in the real
NCERT/Exemplar textbook, presented as a visual lesson on the canvas — not a generic ChatGPT wall of
text. Measurable finish: a student types a Class-10 topic → a grounded, cited, block-structured lesson
blooms in <~2s, reads clearer than the book, and is visibly non-generic; an absent topic degrades
honestly.

## Non-Goals
- No slow knowledge-graph extraction on the teaching path (RAG needs raw text, not verified Statements).
- No embeddings/vector search yet (Postgres full-text first; upgrade only if recall proves weak — its
  own amendment).
- No frontend redesign (deferred to post-MVP by the owner).
- No Redis (YAGNI until a measured latency need).
- No human content review for the RAG path (the review trust-ladder stays for the graph path only).

## Dependencies
- Needs: `pdf-parse` (already admitted, amendment A-4); the existing ingestion chunker; the existing
  streaming model chain (`src/server/advisors/providers.ts`); Postgres full-text (built in — no new dep).
- Needed by: Phase 6 deploy (Neon must have the full-text index + `SOURCE_GROUNDING`).

## Acceptance criteria (student's view)
Ask any Class-10 topic → a visual lesson grounded in the textbook, in plain teacher language, with a
"from NCERT Ch X" source chip, built step by step on the canvas. Re-asking deepens instead of repeating
(Phase 4). Off-book questions still get a smart, labelled answer (Phase 3). A mic lets you talk to it
(Phase 5). It is live (Phase 6).

## The core mechanism — why it won't feel like a normal LLM
The model never "writes an answer"; it **builds a lesson**:
1. **Grounded** — retrieved NCERT passages injected with a hard rule: teach only from these, cite the
   chapter, if uncovered say so. A "from NCERT Ch X" chip shows the source.
2. **Visual-first** — output forced into blocks (mind-map, flowchart, steps, worked example, math), not
   prose. Prose only as short captions inside blocks.
3. **Teacher voice** — strict style contract: textbook's formal words → simplest clear language + one
   analogy; no "certainly", no hedging, no bot phrasing.
4. **Blooms on canvas** — concept → why → example → check, built step by step, camera gliding.

## Method (every phase)
build → verify → fix until green; ship behind an off-by-default flag with one-flip rollback; no earlier
test weakened; `tsc --noEmit` + `lint` + `test` + `build` green before commit. Ship + Monitor = Phase 6.

## Test discipline (every phase — see [CLAUDE.md](../../CLAUDE.md) §H1)
Non-negotiable, applied to every phase below:
1. **Test first** — write the test, run it, watch it FAIL for the right reason, then build until green.
2. **Hard tests** — success + failure/edge/boundary + the exact bug; a test that can't fail is not done.
3. **Never ease a test** to pass — the code is wrong, not the test; tests only ever get stricter.
4. **Mutation-check** — after green, break the impl on purpose and confirm red; inject bad input, prove
   rejection.
5. **Real path** — exercise the real dependency (DB / live service), not just the memory/mock store,
   before a phase is "done".
A phase is NOT green until its test has been *proven able to fail* and the *real* path is exercised.

---

## Phase 1 — Books in + searchable (the bottleneck)
**Build.** `scripts/ingest-corpus.mjs`: NCERT + Exemplar PDFs → `pdf-parse` → clean → reuse the
ingestion chunker → persist `Source` + `SourceChunk` (metadata: grade=10, subject, chapter,
source=NCERT|Exemplar) using the content-addressed ids the schema already defines. Add Postgres
full-text over `SourceChunk.text`: generated `tsvector` column + GIN index (Prisma migration); new
`searchChunks(query, {subject, grade}, limit)` on `KnowledgeStore` — implemented in
`knowledge/store/postgres.ts` (`websearch_to_tsquery` + `ts_rank`), mirrored in `memory.ts`, asserted in
`conformance.ts`.
**Verify.** Test written first and seen to fail (mutation-checked ✅ — broke the impl, saw red);
query "real numbers" / "Euclid division" → correct chapter passages, <100ms; sane chunk counts;
conformance + full suite green. **Real path:** the memory conformance test is proven-fail-able ✅, but
the Postgres `searchChunks` SQL is NOT done until `RUN_DB_CONFORMANCE=1` is green against a live DB and
the ingest self-probe returns hits <100ms.
**Fix.** Loop until green. **Rollback.** New code only; no `searchChunks` caller ships until Phase 2.

## Phase 2 — Teach from books, non-generic (the money moment)
**Build.** `conversation/grounding.ts`: `sourceGroundedOutline(store, topic)` → `searchChunks` → build a
lesson outline seeded with retrieved passages + citations. `chooseOutline` prefers source-grounded when
hits exist, else current `defaultOutline`. Gate behind new `SOURCE_GROUNDING` flag in `src/env.ts` (enum
"0"/"1", default "0", `SOURCE_GROUNDING_ON()` helper — mirror `KNOWLEDGE_GROUNDING`). Presentation
contract in `advisors/chunk.ts` + the outline builder: force block-typed output each tied to a retrieved
passage; strict teacher-voice system prompt; source chip. Guard test: the source-grounding path never
writes a `Statement`/knowledge row (A-7 invariant).
**Verify.** Test written first and seen to fail; mutation-checked; real path (live teach against
ingested DB), not just memory, exercised. 5 topics across chapters → grounded, block-structured, cited
lessons that read clearer than the book and visibly unlike a chatbot; absent topic says so (no
hallucinated confidence). A-7 guard test green (source path writes zero graph rows).
**Fix.** Loop until green. **Rollback.** `SOURCE_GROUNDING=0` restores today's behaviour byte-for-byte.

## Phase 3 — Web fallback
**Build.** `src/server/retrieval/web.ts` (Tavily; free tier). Weak retrieval score → web search → same
presentation contract, labelled web-sourced. Wire into `chooseOutline` below the source tier.
**Verify.** Off-book question → smart, labelled answer; in-book still prefers NCERT.

## Phase 4 — Memory + no-repeat
**Build.** Extend session memory (today only prior *topics* in `conversation/context.ts`) to store Q&A +
which blocks were drawn; feed back into the prompt; on re-ask → vary/deepen, never paste identical.
**Verify.** Ask twice → second is different/deeper.

## Phase 5 — Voice (best FREE stack, self-hosted)
**Build.** Separate **Python** voice microservice (Pipecat is Python — the TS backend is NOT rewritten):
**WebRTC** transport · **Pipecat** orchestration · **faster-whisper** STT · **Kokoro** TTS (over Piper).
Mic button on the Next canvas talks to it over WebRTC + a thin API; it calls the same grounded teach
path. No Redis.
**Verify.** Talk → hear a human-sounding grounded reply.
**Ops note.** whisper+Kokoro can't run on Vercel — the voice service needs its own CPU/GPU box (Fly.io /
Render). Free license, paid-ish ops.

## Phase 6 — Ship + Monitor (parallel)
**Ship.** Author Vercel + Neon (Postgres w/ full-text + `SOURCE_GROUNDING`) + Clerk prod config + one-flip
rollback; owner runs it with real secrets; gradual rollout (flag → small % → all).
**Monitor.** Wire the 4 signals (traffic / errors / latency / saturation) to the existing health
registry; alert on a bad number; a bad signal may STOP rollout.
**Verify.** Live URL + a health check that goes red when something breaks.

## Definition of Done (MVP-1)
`SOURCE_GROUNDING=1`, one+ NCERT chapter ingested, the acceptance criteria met, and
`npx tsc --noEmit && npm run lint && npm test && npm run build` green with the test floor not lowered.
