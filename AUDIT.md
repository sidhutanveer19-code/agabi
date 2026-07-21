# Agabi Frontend — Strict Audit

Evidence-based. Repo-only. Not optimistic. Verdicts: ✓ COMPLETE / ⚠ PARTIAL / ✗ MISSING / NOT VERIFIED.
Runtime gate at audit time: `tsc` 0 · `eslint` 0 · `vitest` 21/21 · `next build` ✓ · Playwright **9/9 across Chromium+Firefox+WebKit**.

---

## 1. Phase-by-phase completion

| Phase | % | Verdict | Basis |
|---|---|---|---|
| 1 — Frontend Foundation | 100% | ✓ | app router `src/app/page.tsx`, tokens `src/config/tokens.ts`, phase machine `hooks/useAgabi.ts`, entry/quick screens |
| 2 — Learning Workspace Foundation | 100% | ✓ | transform-layer canvas `renderer/WorkspaceCanvas.tsx:58`, `camera.store.ts`, `usePanZoom.ts`, regions, append-only store (`workspace.store.ts` — no deleteRegion/undo) |
| 3 — Core Educational Blocks | 100% | ✓ | `blocks/registry.ts`, `manifest.ts`, DEV_MODE gating `BlockFrame.tsx:21`, authoring `BlockShell.tsx` |
| 4 — Advanced Learning Blocks | ~98% | ✓ (1 caveat) | 20 heavy-lib blocks lazy via `next/dynamic({ssr:false})`. Caveat: Tiptap is eager (shared editor), by design |
| 5 — AI Teaching Experience | 100% | ✓ | `ai/useTeaching.ts:57` consumes TeachEvent stream → append-only regions; provider abstraction `ai/types.ts:18` |
| 6 — Backend Integration | ~90% | ⚠ | contract + platform layer complete; **"frontend calculates nothing" is violated** — see §4.1 |
| 7 — Production Hardening | ~95% | ⚠ | security/perf/tests/CSP/e2e all done; remaining: legacy dead code not removed, no automated a11y test |

---

## 2. Library integration matrix (18 requested)

Legend: Installed · Registered · Block dir · Lazy(next/dynamic) · Renders(imports lib) · Serializable(zod+create).

| Library | Status | Block | Notes |
|---|---|---|---|
| KaTeX | ✓ all | `blocks/math` | now code-split (`math/Renderer.tsx`) + `trust:false` |
| Excalidraw | ✓ all | `blocks/excalidraw` | lazy |
| tldraw | ✓ all | `blocks/tldraw` | lazy, snapshot serialize |
| React Flow (@xyflow/react) | ✓ all | `blocks/flow` | lazy |
| Mermaid | ✓ all | `blocks/mermaid` | lazy, `securityLevel:"strict"` |
| Monaco | ✓ all | `blocks/monaco` | lazy |
| Recharts | ✓ all | `blocks/chart` | lazy |
| JSXGraph | ✓ all | `blocks/graph` + `blocks/geometry` | powers 2 blocks |
| MathLive | ✓ all | `blocks/mathfield` | lazy |
| Three.js | ✓ all | `blocks/threed` | lazy |
| React Three Fiber | ✓ all | `blocks/threed` | lazy |
| Matter.js | ✓ all | `blocks/physics` | lazy |
| 3Dmol | ✓ all | `blocks/molecule` | lazy |
| Markmap | ✓ all | `blocks/mindmap` | lazy |
| MapLibre | ✓ all | `blocks/map` | lazy |
| vis-timeline | ✓ all | `blocks/timeline` | lazy |
| react-pdf | ✓ all | `blocks/document` | lazy, url via safeUrl |
| **Tiptap** | ⚠ | shared `blocks/shared/RichText.tsx` | Installed/registered/renders/serializable, but **eager (not lazy)** and **not its own block** (shared by text+admonition). By design; ships in main bundle. |

**17/18 fully integrated per the strict checklist; Tiptap is the one ⚠ (integration pattern differs).** Every library that is present is genuinely wired (registered → wrapped → renders → serializable) — verified live by the Playwright stream test rendering heading/paragraph/formula/callout blocks.

Note: **wavesurfer.js was removed** (unused); the audio block uses the native `<audio>` element — correct, not a gap.

---

## 3. Workspace / AI / Production

**Workspace (all ✓):** infinite canvas, camera, pan, zoom, multiple regions, registry, versioned-zod serialization, save, restore, streaming, virtualization (`useVirtualizedRegions.ts` — culls regions AND blocks, **proven live**: 300 streamed blocks → <150 in DOM, bounded after pan). Selection/resize/duplicate/delete/palette exist and are **correctly DEV_MODE-gated** (students never see authoring).

**AI (all ✓):** streaming, interrupt (9 commands `ai/commands.ts`), continue, explain-differently, multiple append-only regions, region creation, block streaming, provider abstraction, backend relay. Data flow proven: `useTeaching → teachingProvider(real service) → NDJSON streamClient → workspace store`. No mock in the app path (`platform/providers.ts` — no in-app mock).

**Production:** per-block error boundaries + `app/error.tsx` + `app/global-error.tsx`; loading states (route + block + StatusPill); 149 ARIA/role/tabIndex occurrences; reduced-motion honored; CSP enforced (prod) + security headers; safeUrl on every URL sink; no `eval`/`new Function`. e2e proves streaming + restore + enforced-CSP (zero violations) across 3 browsers.

---

## 4. Technical debt / partial implementations (the honest gaps)

### 4.1 Client-side generation still lives in `src/` — contradicts "frontend calculates nothing" ⚠ (the headline finding)
Two parallel teaching systems exist:
- **System B (live canvas):** `LearningWorkspace → useTeaching → teachingService` — pure backend relay, generates nothing. ✓
- **System A (legacy, partly live):**
  - `composeQuickAnswer()` (`features/canvas/lib/compose/index.ts:20`) is **live and user-visible** — called by `quick/QuickScreen.tsx:112`. The "Quick question" path generates its answer **client-side**.
  - `composeLesson()` (`hooks/useAgabi.ts:85`) **executes on every canvas entry**, but its output is **discarded** (LearningWorkspace ignores it) — wasted client generation shipped in the bundle.
  - 3 hardcoded lesson datasets shipped: `features/canvas/data/lessons/{projectile,quadratic,pythagorean}.ts` (`projectile` seeds `session.store.ts:3`).

**Impact:** the shipped bundle is NOT a pure renderer. Not a crash/security blocker, but it violates the Phase-6 architectural principle and adds dead weight. **Decision needed:** should "Quick question" route through the backend `/teach` too (making the frontend a true pure presentation layer), and should `composeLesson`/System A be removed?

### 4.2 Dead code ⚠
- `features/canvas/CanvasScreen.tsx` — **dead** (zero references).
- 10 unused shadcn/ui primitives: `accordion, avatar, breadcrumb, dropdown-menu, menubar, progress, scroll-area, sheet, states, tabs`.
- Legacy `lesson` block + `TeachingBoard` + `canvas/lib/compose/*` — registered/on-disk but not emitted by the backend stream.

### 4.3 Repo-wide marker sweep (exhaustive)
- **TODO / FIXME / HACK / XXX in code: 0.**
- **console.log: 0 in `src/`** (2 in `dev-backend/server.mjs` — expected, not bundled, eslint-ignored). One legitimate `console.error` in `BlockErrorBoundary.tsx:30`.
- **placeholder / mock / fake / dummy / temporary / deprecated:** all occurrences benign (input placeholders, CSS token, doc/comment text, one test helper `fakeDef`). No mock data, no stub logic in `src/`.

### 4.4 Dependency audit
`npm audit`: 13 findings, **all transitive** (Excalidraw→nanoid, Next→postcss build tool). **Zero direct-dependency vulnerabilities.** Only fixes are breaking downgrades (Next→9.x) → accept + monitor upstream.

### 4.5 Accessibility
Strong ARIA/keyboard/reduced-motion coverage, but: **no automated a11y test** (axe/etc.), and student block-level keyboard traversal is limited (canvas keyboard drives camera, not block focus). NOT VERIFIED: screen-reader UX (not tested).

---

## 5. Bugs found
None functional. The e2e suite exercised the real student build across 3 engines with **zero runtime/console/CSP errors**. The only correctness-adjacent issue is architectural (§4.1), not a bug.

## 6. Production blockers
**Hard blockers: none** for the frontend as a presentation layer (builds, typechecks, tests, cross-browser, secure, virtualized).
**Soft blockers / must-decide before "pure presentation layer" is honestly true:**
1. Remove or backend-route System A client generation (§4.1).
2. Remove dead code (§4.2).
3. The **real backend does not exist** — the app talks to `dev-backend/server.mjs` (a stub). Agabi cannot genuinely teach arbitrary topics until the backend is built. This is out of frontend scope but is the real product gate.

## 7. Verdict — is the frontend genuinely production-ready?

**As a frontend/presentation layer: YES, with two honest asterisks.** It compiles, builds, passes 21 unit + 9 cross-browser e2e tests, enforces a CSP with zero violations, guards every URL sink, virtualizes thousands of blocks, recovers from errors, and integrates 17/18 libraries as real serializable blocks.

**It is NOT yet the "pure renderer that calculates nothing" the architecture claims** — legacy client-side generation (`composeQuickAnswer` live, `composeLesson` dead-executing) plus dead code remain in `src/` (§4.1–4.2). These are debt, not blockers.

**It is NOT a finished product** — the intelligence is a dev stub; real per-topic teaching needs the (unbuilt) backend.

**Recommended before launch:** (1) remove/route System A, (2) delete dead code, (3) add an automated a11y check, (4) build the backend. Items 1–3 are small; item 4 is a separate project.
