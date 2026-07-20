# Agabi — Phase 1 Report: Frontend Foundation

**Status:** Complete · **Tag:** `phase-1-complete` · **Branch:** `release/phase-1`
**Commit hash:** `7542616d507c93cff8ad026463bb14b9df62a089`

Phase 1 delivers a production-grade frontend foundation. The three approved screens (Entry, Quick
Question, Canvas sketch board) are preserved pixel-for-pixel; everything else is reusable
infrastructure. `tsc`, ESLint, and `next build` are clean; no `any`, no dead code.

---

## Architecture

- **Tokens are the single source of truth.** `src/config/tokens.ts` (typed) mirrors
  `src/styles/tokens.css` (CSS variables = the shadcn contract, dark default + reserved light).
  Components and screens reference tokens; no magic numbers for color/typography/motion/radius.
- **Libraries sealed by concern.** shadcn/ui (Radix) is the component library, themed via CSS
  variables. The bespoke screens stay bespoke; third-party UI does not leak across the app.
- **State split.** A Zustand `session.store` holds the phase machine; `useAgabi` is the orchestration
  hook (timers, effects, speech, compose, persistence) over it. UI/chrome state lives in `ui.store`.
- **Providers composed once** in `RootProviders`, mounted in the root layout.
- **Routing infra** in place: root `error` / `loading` / `not-found`, plus `ProtectedLayout` and
  `AppShell` primitives ready for future authenticated routes. The product remains a single-surface
  phase machine at `/` (interactions unchanged).

## Folder structure

```
src/
  app/            routes: layout, page, error, loading, not-found, globals.css
  components/ui/  shadcn primitives + Spinner + state components (the library)
  shared/layouts/ ProtectedLayout, AppShell
  features/
    entry/        EntryScreen
    quick/        QuickScreen
    canvas/       CanvasScreen, TeachingBoard, lib/{lesson,compose}, data/lessons
  hooks/          useAgabi, useSpeech, useMediaQuery, useReducedMotion
  providers/      theme, query, toast, dialog, keyboard-shortcut, index (RootProviders)
  stores/         session.store, ui.store
  styles/         tokens.css (shadcn theme contract)
  config/         tokens.ts (typed design tokens)
  constants/      examples.ts
  lib/            motion.ts (Motion presets/transitions)
  utils/          cn.ts
  types/          (reserved)
```

## Installed libraries (used in Phase 1)

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui + Radix UI · tw-animate-css ·
Zustand · TanStack Query · Motion (Framer) · Lucide · Zod · React Hook Form · next-themes · sonner ·
cmdk · clsx · tailwind-merge · class-variance-authority.

> The full approved stack (~110 dependencies incl. future-phase libraries: tldraw, Excalidraw,
> React Flow, Mermaid, KaTeX, Monaco, Recharts, Three/R3F, etc.) is installed and available but not
> wired in Phase 1. `.npmrc` sets `legacy-peer-deps=true` so installs resolve past peer conflicts.

## Components (`src/components/ui`)

**shadcn (26):** button, input, textarea, label, checkbox, radio-group, switch, select,
dropdown-menu, menubar, card, sheet (drawer), dialog, popover, tooltip, sonner (toast), command
(palette), badge, avatar, tabs, accordion, breadcrumb, separator, skeleton, progress, scroll-area.
**Custom (4):** Spinner, EmptyState, ErrorState, SuccessState.
**Layout primitives:** ProtectedLayout, AppShell.
All keyboard-accessible via Radix; variant coverage (primary/secondary/ghost/outline/destructive/
disabled + focus/hover/pressed/selected).

## Providers (`src/providers`)

ThemeProvider (next-themes, dark default) · QueryProvider (TanStack) · ToastProvider (sonner) ·
DialogProvider (imperative `useDialog().confirm`) · KeyboardShortcutProvider (`useKeyboardShortcut`)
· TooltipProvider — composed in `RootProviders`, mounted once in `app/layout.tsx`.

## Stores (`src/stores`)

- `session.store.ts` — Zustand store for the session phase machine (Entry/Quick/Canvas + lesson,
  variant, drawing/paused/voice/mic state). `useAgabi` orchestrates it.
- `ui.store.ts` — global chrome/UI state (command-palette open, etc.).

## Design system

`config/tokens.ts`: color (surface/ink/muted/accents + semantic roles + subject accents), typography
(display/h1–h6/body/caption/label/mono/code/hand with size/weight/lineHeight/letterSpacing/font),
spacing scale, radius, border, elevation/shadow, opacity, z-index, motion durations + easing,
container sizes, breakpoints. `styles/tokens.css` maps them to the shadcn variable contract
(`--background --foreground --primary --muted --border --ring --radius …`), dark default with a
reserved `:root[data-theme="light"]`. Global CSS keeps the ported keyframes + bespoke screen classes.

## Known limitations

- **Screen spacing/size literals stay bespoke.** Color, typography, and motion are fully tokenized;
  the screens' one-off layout coordinates remain literals (the approved design's exact values —
  tokenizing them would either drift pixels or add noise).
- **next-themes** emits a dev-only React 19 script warning; benign (dark applies via CSS `:root`
  default) and absent from the production build.
- **Light theme** is a reserved stub; final values are a later pass. Agabi ships dark.
- **Parked Phase-2 code** (workspace, blocks, services, gallery, AI route) was removed from the tree
  to satisfy "no dead code" and is preserved in git commit `c0faa43`. Phase 2 restores it from there
  rather than rebuilding.
- No automated tests yet; verification is type/lint/build + browser regression.

## Snapshot references

- **Tag:** `phase-1-complete`
- **Branch:** `release/phase-1`
- **Commit hash:** `7542616d507c93cff8ad026463bb14b9df62a089`
- **Archives:** `agabi-phase-1-complete.zip`, `agabi-phase-1-complete.tar.gz` (source only; no
  `node_modules` / `.next` / `.git`).
