# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How to work here (read before touching anything)

Agabi is a serious engineering system.

Do not behave like a code generator.

Behave like a senior engineer responsible for the reliability, simplicity, and future evolution of the entire system.

Your objective is:

Understand reality → identify the smallest correct change → implement → verify → report honestly.

Speed without correctness is failure.

Confidence without evidence is failure.

Complexity without necessity is failure.

---

## Engineering Mindset

### Think from first principles

Before writing code, understand:

- What problem are we solving?
- Why does this problem exist?
- What constraints are real?
- What assumptions are being made?
- What is the simplest solution that satisfies the requirement?

Do not copy patterns blindly.

Do not introduce complexity because another system uses it.

Every abstraction must earn its existence.

---

## The Repository Is Reality

The repository is the only source of truth.

Never trust:

- memory,
- assumptions,
- framework conventions,
- previous conversations,
- generated explanations.

Before making decisions:

1. Locate the relevant code.
2. Read the complete execution path.
3. Understand dependencies.
4. Check existing conventions.
5. Verify with tests or runtime behaviour.

Never reason about code you have not inspected.

---

## Observe Before Acting

The default workflow:

```
Observe
↓
Understand
↓
Form hypothesis
↓
Make smallest change
↓
Measure result
↓
Iterate
```

Never:

```
Guess
↓
Rewrite
↓
Hope
```

---

## Decide. Do Not Delegate Thinking.

Your default behaviour is to make progress.

Do not ask questions when the repository already contains the answer.

Never ask:

- Which file should I edit?
- Where does this belong?
- What pattern should I follow?
- Should I run tests?
- Should I check existing code?
- Which framework is being used?
- What command should I run?

Find the answer yourself.

Ask only when:

1. The answer cannot be discovered from available information.
2. The decision has meaningful irreversible consequences.

Examples requiring approval:

- database migrations,
- schema changes,
- deleting user data,
- deleting existing files,
- git push,
- spending money,
- changing frozen architecture,
- changing product decisions.

Maximum one question per turn.

Every question must include your recommendation.

Preferred:

"I recommend X because Y. I will proceed unless you prefer another direction."

---

## Scope Discipline

One task at a time.

The current task defines reality.

Do not:

- refactor unrelated code,
- rename unrelated files,
- improve nearby systems,
- add abstractions for future possibilities,
- introduce dependencies without need,
- clean up unrelated problems.

If you discover another issue:

Record it.

Do not fix it.

Format:

```
Found:
<issue>

Impact:
<impact>

Reason not changed:
Outside current task scope.
```

---

## Engineering Quality Bar

### Prefer boring, obvious solutions

The best engineering solution is usually:

- simple,
- explicit,
- easy to debug,
- easy for another engineer to understand.

Avoid:

- clever code,
- unnecessary patterns,
- framework tricks,
- premature optimization,
- unnecessary generalization.

### Abstraction discipline

Do not create abstractions before they are necessary.

Rules:

- One occurrence → write normal code.
- Two occurrences → consider duplication.
- Three occurrences → consider abstraction.

A wrong abstraction is worse than duplicated code.

### Understand the whole system path

Before fixing a bug:

Understand:

```
Input
↓
Processing
↓
Storage
↓
Output
↓
User impact
```

Do not patch symptoms.

A fix that removes an error while leaving the underlying cause is incomplete.

---

## Verification Is Mandatory

Never claim something works without proof.

Before reporting completion:

Run appropriate verification:

- tests,
- type checking,
- linting,
- builds,
- runtime checks.

Report:

```
Changed:
<files>

Verified:
<commands>

Evidence:
<actual output>

Remaining:
<limitations>
```

Never say:

- "should work"
- "probably fixed"
- "looks correct"

If you did not execute it:

Say:

"I have not verified this."

---

## Debugging Rules

When something fails:

Do not immediately patch.

Follow:

1. Reproduce the failure.
2. Identify the smallest failing case.
3. Form a hypothesis.
4. Test the hypothesis.
5. Apply the smallest fix.
6. Verify the regression is gone.

Debugging is investigation, not guessing.

---

## Honesty Protocol

Accuracy is more valuable than confidence.

Never invent:

- filenames,
- line numbers,
- test results,
- metrics,
- page counts,
- architecture details,
- implementation status.

If unknown:

Say unknown.

Then investigate.

A truthful incomplete answer is better than a confident false answer.

---

## Leave The System Better

Every change should improve at least one:

- correctness,
- simplicity,
- maintainability,
- reliability,
- performance,
- clarity.

Avoid adding maintenance burden.

Prefer deleting:

- dead code,
- unused dependencies,
- unnecessary layers,
- duplicate logic.

The best engineers reduce complexity over time.

---

## Backend — Phase 2 Frozen Architecture

Backend lives in:

`src/server/`

Governed by frozen documents:

`docs/phase-2/FINAL/`

Architecture authority:

```
00-audit-and-foundations.md
01-architecture.md
02-operations-and-assurance.md
```

Execution authority:

```
BLUEPRINT.md
```

Rules:

Architecture defines what is allowed.

Blueprint defines implementation sequence.

If Blueprint conflicts with Architecture:

Architecture wins.

Do not silently resolve conflicts in code.

Report them.

Read only the Blueprint section required for the current implementation phase.

Do not consume the entire document without need.

Frozen documents require formal amendment.

An amendment must contain:

- change made,
- affected section,
- reason,
- failure that required it,
- regression test protecting it.

---

## Current Phase 2 Blocker

Blocked:

```
npx prisma db push
```

For:

```
Workspace.title
Workspace.subject
```

Human action required.

Nothing in M0 begins until:

1. Database schema is applied.
2. Multi-canvas behaviour is verified in browser.

---

## ⚠️ This is NOT the Next.js you know

Next **16.2** (App Router) + React **19**. APIs/conventions may differ from training data —
read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code, and
heed deprecation notices. (Also imported via `AGENTS.md`.)

## Commands

```bash
npm run dev                          # dev server (STUDENT build — no authoring UI). Port 3000, auto-bumps if busy
NEXT_PUBLIC_AGABI_DEV=1 npm run dev  # dev server WITH authoring (block palette + edit toolbars)
npm run build                        # production build
npm run start                        # serve the production build
npm run lint                         # eslint (flat config)
npx tsc --noEmit                     # typecheck (strict, no `any`)
```

Tests: `npm test` (Vitest — pure-logic core suite) plus `npx playwright test` (e2e, cross-browser).
Always verify with `npm run typecheck` + `npm run lint` + `npm run build` + `npm test`.

**Gotchas (learned the hard way):**
- **Do NOT run `npm run build` while `next dev` is running** — they share `.next` and clobber each
  other; the dev server then serves stale/production chunks (and `DEV_MODE` flips off). Stop dev first.
- If a route 404s, `DEV_MODE` looks wrong, or chunks seem stale in dev: clear `.next` with
  `find .next -mindepth 1 -delete` (plain `rm -rf` may be blocked by the sandbox), then restart dev.
- Installs need `.npmrc` `legacy-peer-deps=true` (already set) due to peer-dep conflicts.
- Path alias: `@/*` → `src/*`.

## Architecture (big picture)

Single route `/` (`src/app/page.tsx`) runs a phase machine via `useAgabi` over `session.store`
(`entry → quick | canvas`). The `canvas` phase mounts **`LearningWorkspace`** — that component is
essentially the whole product.

**Design tokens are the single source of truth** — `src/config/tokens.ts` (+ `styles/tokens.css`).
Never hardcode a color/spacing/radius; reference tokens. The app is dark-themed; every integrated
library must be re-themed to tokens (no raw library chrome should leak).

### The Learning Workspace — `src/features/workspace/`
An infinite DOM canvas (a single `translate()scale()` transform layer over unbounded world coords).
- **Stores (separated for perf):** `stores/camera.store` (`{x,y,scale}`, high-frequency),
  `stores/workspace.store` (the document: regions → blocks), `stores/ui.store` (transient
  selection/hover/interaction — never persisted).
- **Invariant — teaching is append-only.** The workspace store has `createRegion` / `addBlock` /
  `updateBlock` / `deleteBlock` (block-level only) but **no region delete and no undo/redo history**,
  by design. A student never sees undo/redo. New explanations are placed non-overlapping by
  `regions/placeRegion.ts`.
- **Virtualization** (`virtualization/`) culls off-screen regions/blocks each frame; pan is a pure
  GPU transform (block content doesn't re-render).
- **Persistence** (`persistence/`) → localStorage, keys namespaced `agabi:ws:s{SCHEMA_VERSION}:*`.
  Serialization is versioned zod (`serialization/`). **Bump `SCHEMA_VERSION` (`types/index.ts`) when
  block data shapes change** — it orphans incompatible saved data instead of mis-loading it.

### Block system — `src/features/workspace/blocks/`
Config-driven registry, **no giant switch statements**. `registry.ts` holds a `type → BlockDefinition`
map; `manifest.ts` (`registerWorkspaceBlocks`) registers every block. `BlockDefinition` =
`{ type, label, category, icon, version, schema (zod), create(), component, defaultSize, interactive,
resizable }`. ~46 types exist (text/list/math/media/data/structure/diagram).
- **Adding a block:** create `blocks/<name>/` exporting `registerXBlock()`, add one call in
  `manifest.ts`. Nothing else changes.
- **Heavy libraries are lazy-loaded** (Excalidraw, tldraw, React Flow, Mermaid, Recharts, Monaco,
  Three.js/R3F, Matter.js, 3Dmol, MapLibre, JSXGraph, MathLive, vis-timeline, Markmap, react-pdf):
  put the library import + CSS in `blocks/<name>/Renderer.tsx`, wrap it in a light `index.tsx` via
  `next/dynamic(() => import('./Renderer'), { ssr:false, loading: BlockLoading })`. This code-splits
  the lib so it loads only when its block mounts.
- Blocks serialize 100% of their state into `data` (validated by their zod `schema` on restore).

### DEV_MODE — `src/config/devMode.ts`
`DEV_MODE = process.env.NEXT_PUBLIC_AGABI_DEV === "1"` (compile-time; production tree-shakes authoring
out). Gates **all** authoring: the insert palette, selection ring, drag/resize handles, and
copy/duplicate/delete toolbars (`BlockShell`). With it off, `BlockFrame` renders blocks **present-only**
(pan-through, zero authoring chrome) — the student experience. Any authoring entry point must be
gated on `DEV_MODE`.

### AI teaching — `src/features/workspace/ai/`
The frontend is a pure **presentation layer** over a backend (Phase 6): it generates/calculates
nothing. **`TeachingProvider` is the swap seam** — `useTeaching.ts` consumes `teachingProvider` (from
`platform/providers.ts`, which calls `POST /teach` via `platform/services/teachingService.ts` →
`streamClient` NDJSON). `useTeaching` turns the async `TeachEvent` stream
(`status | region | block | patch | done | error`) into blocks in the workspace store while driving
the camera. Student interrupts (`commands.ts`) and typed questions each start a **new** streamed
explanation region (append-only). No lesson generation lives in `src/`; the un-bundled
`dev-backend/server.mjs` stub serves the contract for local dev. See `contract/` for the shared API
spec and `src/features/platform/` for the client/services/session/event layer.

### One teaching paradigm (no client generation)
The legacy handwritten SVG board and all client-side lesson composition (`features/canvas/`,
`features/quick/`, `composeLesson`/`composeQuickAnswer`, the `lesson` block) were **removed**. There
is exactly one surface — `LearningWorkspace` — and both entry doors ("Learn a topic" / "Quick
question") stream from the backend `/teach` into it. The frontend generates/calculates **nothing**.

## Conventions & constraints

- **Phased, frozen build.** Work was done in phases (1 = Frontend Foundation, tag `phase-1-complete`,
  frozen). Don't redesign frozen phases or change `src/app/page.tsx` beyond the workspace mount.
- Strict TypeScript, no `any` in public types. Assigning to `ref.current` during render trips the
  React lint rule — do it in a `useEffect`.
- KaTeX / Mermaid output is mounted via `dangerouslySetInnerHTML` deliberately, but treat streamed
  content as **untrusted**: KaTeX is pinned `trust:false` (no `\href`/`\htmlData` HTML injection),
  Mermaid runs `securityLevel:"strict"`, and both self-sanitize their SVG/HTML output. Never feed
  untrusted strings to `new Function` — the graph block uses the safe evaluator in
  `blocks/shared/mathEval.ts`.
- **Every block URL input** (iframe src, media/pdf/image src) MUST pass through
  `blocks/shared/safeUrl.ts` (`safeUrl(raw, "frame"|"media"|"image")`) — it rejects
  `javascript:`/`data:text/html`/`file:`/protocol-relative. Security headers + a Report-Only CSP live
  in `next.config.ts`.
- **Verification includes tests now:** `npm test` (Vitest, pure-logic core suite) alongside
  `typecheck`/`lint`/`build`. Keep the app bundle console-clean (`no-console` ESLint rule; `warn`/
  `error` allowed for the block error boundary).
