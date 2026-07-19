/**
 * Agabi design tokens — the single source of truth for styling values.
 * Ported from the Claude design; consumed by primitives, blocks, and the
 * canvas. Never hardcode a hex/spacing value in a component — reference these.
 */

export const color = {
  bg: "#06070c",
  paper: "#0a0c11",
  surface: "rgba(255,255,255,0.03)",
  surfaceHover: "rgba(255,255,255,0.06)",
  surfaceActive: "rgba(255,255,255,0.09)",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",

  ink: "#f3eee6",
  inkBright: "#f6f1e9",
  inkSoft: "#ede8df",
  inkDim: "#d8d0c2",
  muted: "#8b8579",
  muted2: "#6b6659",
  muted3: "#b0a899",

  violet: "#7c3aed",
  violet2: "#a78bfa",
  violet3: "#c4b5fd",
  cyan: "#38bdf8",
  cyan2: "#7dd3fc",
  green: "#6fcf97",
  orange: "#e8944e",
  gold: "#d9c36b",
  danger: "#f16d6d",
} as const;

/** Per-subject accent so the workspace tints to context without changing shape. */
export const subjectAccent = {
  Mathematics: "#a78bfa",
  Physics: "#7dd3fc",
  Chemistry: "#6fcf97",
  Biology: "#8be9a6",
  History: "#e8944e",
  Geography: "#5fb0e8",
  English: "#d9c36b",
  "Computer Science": "#7dd3fc",
  AI: "#a78bfa",
  Economics: "#e8b04e",
  Law: "#c4b5fd",
  General: "#a78bfa",
} as const;

export type Subject = keyof typeof subjectAccent;

export function accentFor(subject: string | undefined): string {
  return (subjectAccent as Record<string, string>)[subject ?? "General"] ?? subjectAccent.General;
}

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const elevation = {
  1: "0 1px 2px rgba(0,0,0,.3)",
  2: "0 6px 20px rgba(0,0,0,.35)",
  3: "0 14px 40px rgba(0,0,0,.45)",
} as const;

/** Layering scale — keep every z-index here to avoid stacking bugs. */
export const z = {
  canvas: 1,
  block: 2,
  blockSelected: 3,
  chrome: 10,
  bar: 20,
  overlay: 40,
  popover: 60,
  toast: 80,
} as const;

export const motion = {
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  fast: 0.15,
  base: 0.25,
  slow: 0.5,
} as const;

export const font = {
  display: "var(--font-display, 'Fraunces', serif)",
  sans: "var(--font-sans, 'DM Sans', sans-serif)",
  mono: "var(--font-mono, monospace)",
  hand: "var(--font-hand, 'Caveat', cursive)",
} as const;

export const typeScale = {
  eyebrow: { size: 10, tracking: "0.16em", transform: "uppercase" as const },
  caption: { size: 12.5, tracking: "0" },
  body: { size: 15, tracking: "0" },
  bodyLg: { size: 17, tracking: "0" },
  h3: { size: 22, tracking: "-0.01em" },
  h2: { size: 30, tracking: "-0.012em" },
  h1: { size: 42, tracking: "-0.015em" },
  display: { size: 47, tracking: "-0.015em" },
} as const;
