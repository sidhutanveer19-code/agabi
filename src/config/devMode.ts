/**
 * DEV_MODE — the single gate for all authoring affordances.
 *
 * When ON: the block insert palette, selection, drag/resize handles, and the
 * copy/duplicate/delete toolbars are available (for building + verifying the
 * block library, and the surface a future AI drives).
 *
 * When OFF (the production student build): none of that renders. Students see
 * present-only blocks — pure content, no authoring chrome, no undo/redo.
 *
 * Compile-time constant so the production bundle tree-shakes the authoring UI
 * out entirely. Enable with `NEXT_PUBLIC_AGABI_DEV=1`.
 */
export const DEV_MODE = process.env.NEXT_PUBLIC_AGABI_DEV === "1";

/** Hook form for components that prefer a hook over the constant. */
export function useDevMode(): boolean {
  return DEV_MODE;
}
