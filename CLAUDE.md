# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
