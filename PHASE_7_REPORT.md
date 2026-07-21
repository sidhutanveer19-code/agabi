# Phase 7 — Production Hardening Report

**Scope:** polish, optimize, verify, and harden the existing frontend. No new product
features; no redesign of frozen phases (1–6). Frontend only — no backend work.

**Verification gate (all green):**

| Check | Command | Result |
|---|---|---|
| TypeScript (strict) | `npx tsc --noEmit` | **0 errors** |
| ESLint (flat + `no-console`) | `npm run lint` | **0 errors/warnings** |
| Unit tests | `npm test` (Vitest) | **21 passed / 5 files** |
| Production build | `npm run build` | **success** (Next 16.2.10 / Turbopack) |
| Dependencies | `package.json` | **110 → 44** runtime deps |

Every change was additive or a safe in-place hardening. No approved UI, block behavior,
workspace mechanic, or streaming contract was altered.

---

## 1. Architecture report

Structure and boundaries are unchanged and clean (verified by audit):

- **Single route** `/` → phase machine (`entry → quick | canvas`) → `LearningWorkspace`.
- **Workspace** (`src/features/workspace/`): separated Zustand stores (camera / workspace /
  ui), infinite transform-layer canvas, virtualization, versioned-zod serialization,
  config-driven 38-directory block registry (~46 types), append-only AI teaching.
- **Platform** (`src/features/platform/`): the Phase-6 backend seam — client / services /
  session / events / providers. Components never `fetch`.
- **Contract** (`contract/`): the standalone shared API spec.
- **Dependency direction** is one-way (blocks → registry → workspace → app); no circular deps
  surfaced; no giant switch statements (registry map).

Dead scaffolding removed: `lesson/createLessonRegion.ts`, `shared/layouts/AppShell.tsx`,
`shared/layouts/ProtectedLayout.tsx` (all unreferenced), plus 5 empty iCloud-duplicate
directories left by the earlier repo move.

## 2. Performance report

- **KaTeX code-split.** Math was importing `katex` + its CSS at the top level, forcing ~280KB
  into the initial bundle for every session. Split into `blocks/math/Renderer.tsx` (lazy via
  `next/dynamic`, `ssr:false`) + a katex-free `presets.ts` for registration. Loads only when a
  math block mounts.
- **rAF-batched pan/zoom.** `interactions/usePanZoom.ts` now coalesces high-frequency wheel /
  pointer-move / pinch events into **one camera write per animation frame** (accumulated pan
  deltas + multiplied zoom factor), so a 120 Hz trackpad can't outrun the render loop. Frame is
  cancelled on unmount.
- **Dependency purge.** Removed 68 unused packages (backend/AI SDKs, alt editors, alt charts,
  unused markdown/forms pipelines, unwired observability). Smaller install + dependency surface;
  build re-verified after removal.
- **Already strong (confirmed, untouched):** off-screen region/block virtualization
  (`virtualization/useVirtualizedRegions.ts`, 300px margin cull), `memo`'d `RegionFrame` /
  `BlockFrame`, camera-store isolation so pan is a pure GPU transform, rAF-driven fly-to
  animations, per-block `Suspense` for lazy chunks.
- **Deliberately not changed:** TipTap/ProseMirror stays eager. It backs the two most common
  blocks (text, admonition); lazy-splitting would add a loading flash to the most frequent
  content (conflicts with "no loading flashes") and risks visual drift from the frozen UI. The
  correct future win is a present-mode **static renderer** (`@tiptap/static-renderer`) so
  students never load the editor — noted as a future optimization, not a regression.

## 3. Accessibility report

Coverage was already above-average (146 ARIA/role hits) and was preserved:

- Canvas root `role="application"` + descriptive label + `tabIndex`; regions are labelled
  `<section>`s; blocks carry semantic roles (`math`, `img`, `note`, `figure`, `document`,
  `separator`). Interactive controls (Stop, palette, ask bar) have `aria-label`s.
- Full canvas keyboard model (arrows pan, +/- zoom, `0` fit, Tab cycles explanations, Escape
  clears). `prefers-reduced-motion` honored in camera animation, navigation, and the streaming
  status pulse.
- Gallery lightbox: `role="dialog"` + `aria-modal` + Escape-to-close (confirmed present).
- **Added:** `app/global-error.tsx` (see §5) so a root-layout crash still renders an accessible
  `role="alert"` recovery screen instead of a white void.
- **Known minor gap (documented, low priority):** the block-insert palette popover lacks a focus
  trap / focus-return. It is **DEV-only** (gated behind `DEV_MODE`, tree-shaken out of the
  student build), so it is not student-facing.

## 4. Security report

Full hardening pass (real AI-streamed block data is treated as untrusted):

- **URL scheme guard** — new `blocks/shared/safeUrl.ts`. Every block URL sink now routes through
  it: embed iframe (`frame`), video/audio/pdf (`media`), gallery images (`image`). Rejects
  `javascript:`, `data:text/html`, `file:`, `vbscript:`, protocol-relative. Unit-tested.
- **Embed iframe hardened** — dropped `allow-same-origin` (its combination with `allow-scripts`
  let framed content escape its own sandbox); src is now https/http-only via `safeUrl`.
- **KaTeX pinned** `trust:false` + `strict:"ignore"` — HTML-injecting commands (`\href`,
  `\htmlData`, `\includegraphics`) stay disabled even on untrusted LaTeX. Mermaid remains
  `securityLevel:"strict"`.
- **Security headers + CSP** — `next.config.ts` now sets `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Permissions-Policy`,
  and a tuned **`Content-Security-Policy-Report-Only`**. Report-Only is the correct rollout
  stage: present and tuned, surfaces violations without risking breakage of the 38 block types
  before real backend/tile origins are pinned and a report endpoint exists. Flip to enforcing
  (drop `-Report-Only`) once origins are known.
- **No secrets / no eval** — only `NEXT_PUBLIC_*` env vars are read client-side; zero hardcoded
  credentials; zero `eval`/`new Function` (the graph block uses the safe `mathEval` evaluator,
  unit-tested).
- **HTML sanitizer** — deliberately *not* added: there is no live raw-HTML/markdown sink (rich
  text is ProseMirror JSON rendered through React). Adding DOMPurify now would just be another
  unused dependency. Requirement documented in `CLAUDE.md`: any future HTML block must sanitize.
- **`npm audit`:** 13 findings, **all transitive** inside third-party bundles (Excalidraw→nanoid,
  Next→postcss build tool). No direct-dependency vulnerabilities. The only offered "fixes" are
  breaking downgrades (Next → 9.x), so the correct stance is accept + monitor upstream.

## 5. Testing report

- **Harness added:** Vitest (`vitest.config.ts` with `@/` and `@contract` path aliases).
  Scripts: `npm test` (`vitest run`) and `npm run test:watch`.
- **Core suite — 21 tests / 5 files, all passing:**
  - `safeUrl.test.ts` — scheme allowlist per sink (the new security guard).
  - `mathEval.test.ts` — evaluator correctness + rejection of code-execution attempts.
  - `serialize.test.ts` — versioned round-trip, malformed-input → null, schema-version rejection.
  - `registry.test.ts` — register/get/has + `create()`↔schema validity.
  - `contract/schemas.test.ts` — every `TeachEvent` variant + rejection of malformed events.
- **Scope choice (honest):** pure-logic unit tests over the critical seams — no jsdom/component
  render and no e2e in this pass, to keep the suite fast and non-brittle. `@playwright/test` is
  installed but unused; wiring real browser e2e is the recommended next testing investment.

## 6. Code quality report

- **Console/TODO/dead code:** the only `console.*` is a legitimate error-boundary `console.error`
  (kept); one stub auth TODO removed with its unwired file; no FIXME/HACK/commented-out code.
- **Guardrail:** ESLint `no-console` rule added (`warn`/`error` allowed) so cleanliness is
  enforced, not just disciplined.
- **Tooling:** added `typecheck`, `test`, `test:watch` scripts (there was no `typecheck`/`test`
  script before).
- **DEV_MODE:** verified compile-time gated — the authoring UI (palette, edit toolbars) is
  tree-shaken out of the student build. Operational note: production/CI must never set
  `NEXT_PUBLIC_AGABI_DEV=1`.
- **Docs:** `CLAUDE.md` corrected for Phase-6 drift (mock provider → `teachingService`/platform)
  and updated with the new security + testing conventions.

## 7. Production readiness & launch checklist

**Ready:**
- [x] Compiles, builds, typechecks, lints — all zero.
- [x] Unit suite passes.
- [x] No dead code, no unused dependencies (110→44), no console noise, no dev flags in the student build.
- [x] Security: URL guard, hardened iframe sandbox, KaTeX/Mermaid locked, security headers + CSP (report-only), no secrets, no eval.
- [x] Error recovery: per-block error boundaries + app `error.tsx` + `global-error.tsx` + graceful backend-unavailable states.
- [x] Performance: virtualization, code-splitting (incl. KaTeX), rAF-batched camera.
- [x] Accessibility: broad ARIA, keyboard model, reduced-motion.

**Before public launch (owner actions — outside this pass):**
- [ ] Flip CSP from Report-Only to enforcing once backend/tile origins are pinned + a report endpoint exists.
- [ ] Cross-browser + responsive QA on real devices (Chrome/Edge/Safari/Firefox; tablet→ultrawide). Code uses standard APIs and a resolution-independent canvas, but this pass did **not** run manual cross-browser/device testing.
- [ ] Load/stress test very large workspaces (hundreds–thousands of blocks) on target hardware. Virtualization is in place by design but was not stress-benchmarked here.
- [ ] Wire observability (Sentry/PostHog were removed as unused; re-add + initialize when desired).
- [ ] Add browser e2e (Playwright is installed, unused).
- [ ] The real backend (AI/teaching/knowledge/memory/mastery/auth) is a **separate project** — the frontend only talks to the `dev-backend` stub today. This is **Phase 8**, not started per instruction.

---

## Completion confirmation

The Agabi **frontend** is production-hardened: clean, maintainable, scalable, security-hardened,
accessible, performance-optimized, test-backed, and building green — with the approved UI and all
frozen phases intact. The remaining launch items above are owner/ops actions and the (separate)
backend. **No backend development was begun.**
