# Agabi Frontend Architecture

Agabi is the interface of a Learning Operating System. The AI teaches by composing **reusable
educational blocks** on **Agabi's own infinite canvas**. This document is the contract every
contributor follows.

## Golden rules

1. **Agabi owns the surface.** The workspace controls layout, camera, navigation, persistence,
   and composition. No third-party library owns the canvas.
2. **Libraries live inside blocks.** A viz/editor library (tldraw, React Flow, Mermaid, KaTeX,
   Monaco, Recharts, …) may be imported **only** inside its own `src/blocks/<name>/`. Nothing
   else imports it. Swapping a library touches exactly one folder.
3. **Everything is a token.** Colors, spacing, radius, motion come from `src/design-system/
   tokens.ts`. Never hardcode a hex or magic number in a component.
4. **Mocks behind interfaces.** UI talks to `src/services/*` interfaces via TanStack Query
   hooks, never to a mock directly. Replacing a mock with a real API changes one file.
5. **Never blank.** A failing block renders a fallback card (error boundary); a missing lesson
   degrades to a generic one. The student always sees something coherent.

## Layers

```
design-system/  tokens + primitives + motion   (styling source of truth)
workspace/      document model, infinite canvas, block framework
blocks/<name>/  concrete blocks; each wraps ONE library behind the block contract
services/       interfaces + mock impls + getService() factory
hooks/          TanStack Query hooks over services
lib/            shared utilities and hooks
data/           static seed data (e.g. sketch-block lessons)
```

## Block contract

```ts
type BlockInstance<T = unknown> = { id: string; type: BlockType; layout: BlockLayout; data: T };
type BlockDefinition<T> = {
  type: BlockType; label: string; category: BlockCategory;
  icon?: ReactNode; defaultSize: { w: number; h: number };
  schema: ZodType<T>;                 // validates data at the boundary
  Renderer: ComponentType<{ data: T; block: BlockInstance<T> }>;  // lazy-loaded
};
```

`blockRegistry` (built from `workspace/blocks/manifest.ts`) maps `type → definition`.
`BlockRenderer` resolves the definition and renders it inside `BlockFrame` (positioning,
selection, a11y) wrapped by `BlockErrorBoundary` + `Suspense` (skeleton fallback). Heavy
renderers use `next/dynamic(..., { ssr: false })` so each library code-splits.

## Adding a block

1. `src/blocks/<name>/Renderer.tsx` — wrap the library, consume `data`.
2. `src/blocks/<name>/definition.ts` — export `BlockDefinition` (schema + lazy Renderer).
3. Register it in `workspace/blocks/manifest.ts`.
4. Add a sample to `/gallery`.

No other file changes. That is the whole point.
