import { describe, it, expect } from "vitest";

/**
 * motion.ts — shared Framer/`motion` presets derived from design tokens.
 * PURE module: no I/O, no clock, no DB — nothing to fake. Every assertion names
 * the EXACT concrete value the token wiring must produce (duration seconds +
 * the Agabi cubic-bezier ease `[0.16, 1, 0.3, 1]`), never "returned an object".
 *
 * The only real BRANCHES are the three factory default params:
 *   - slideInX(x = 24) / slideInY(y = 24) / staggerParent(stagger = 0.06)
 * Each is exercised: default (arg omitted), explicit value, the falsy-`0` edge
 * (default params trigger ONLY on `undefined`, so 0 must be kept), explicit
 * `undefined` (must fall back to the default), and a negative value.
 */

import {
  transition,
  fadeUp,
  fadeIn,
  paperIn,
  popIn,
  scaleIn,
  slideInX,
  slideInY,
  staggerParent,
  pageTransition,
  modalTransition,
} from "@/lib/motion";

/** The Agabi easing curve, as the concrete value the module must embed. */
const EASE = [0.16, 1, 0.3, 1];

/** Concrete transition presets the token durations must resolve to (seconds). */
const T_FAST = { duration: 0.15, ease: EASE };
const T_BASE = { duration: 0.25, ease: EASE };
const T_SLOW = { duration: 0.5, ease: EASE };
const T_SLOWER = { duration: 0.8, ease: EASE };

/** Coerce a `Variant` (object | resolver | undefined) to a plain comparable record. */
const obj = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

describe("motion — transition presets (token duration + ease wiring)", () => {
  it("resolves fast/base/slow/slower to exact seconds + the Agabi ease", () => {
    expect(transition).toEqual({
      fast: T_FAST,
      base: T_BASE,
      slow: T_SLOW,
      slower: T_SLOWER,
    });
  });

  it("embeds the ease as the concrete cubic-bezier tuple, not some other curve", () => {
    expect(obj(transition.base).ease).toEqual([0.16, 1, 0.3, 1]);
    expect(obj(transition.slower).duration).toBe(0.8);
  });
});

describe("motion — static Variants have exact hidden/show shapes", () => {
  it("fadeUp: y:10 → 0 on the slow transition", () => {
    expect(obj(fadeUp.hidden)).toEqual({ opacity: 0, y: 10 });
    expect(obj(fadeUp.show)).toEqual({ opacity: 1, y: 0, transition: T_SLOW });
  });

  it("fadeIn: opacity-only, with an inline 0.4s transition (NOT a token preset)", () => {
    expect(obj(fadeIn.hidden)).toEqual({ opacity: 0 });
    expect(obj(fadeIn.show)).toEqual({ opacity: 1, transition: { duration: 0.4, ease: EASE } });
  });

  it("paperIn: scale 1.03 → 1 on the slower transition", () => {
    expect(obj(paperIn.hidden)).toEqual({ opacity: 0, scale: 1.03 });
    expect(obj(paperIn.show)).toEqual({ opacity: 1, scale: 1, transition: T_SLOWER });
  });

  it("popIn: scale 0.96 → 1 on the base transition", () => {
    expect(obj(popIn.hidden)).toEqual({ opacity: 0, scale: 0.96 });
    expect(obj(popIn.show)).toEqual({ opacity: 1, scale: 1, transition: T_BASE });
  });

  it("scaleIn: scale 0.98 → 1 on the base transition (distinct start scale from popIn)", () => {
    expect(obj(scaleIn.hidden)).toEqual({ opacity: 0, scale: 0.98 });
    expect(obj(scaleIn.show)).toEqual({ opacity: 1, scale: 1, transition: T_BASE });
    // Guard the two are not accidentally identical.
    expect(obj(scaleIn.hidden).scale).not.toBe(obj(popIn.hidden).scale);
  });
});

describe("motion — slideInX default-param branch", () => {
  it("default (arg omitted) → x defaults to 24, animates to 0 on base", () => {
    expect(slideInX()).toEqual({
      hidden: { opacity: 0, x: 24 },
      show: { opacity: 1, x: 0, transition: T_BASE },
    });
  });

  it("explicit value → x is the provided offset", () => {
    expect(obj(slideInX(60).hidden)).toEqual({ opacity: 0, x: 60 });
  });

  it("explicit undefined → falls back to the 24 default (not undefined)", () => {
    expect(obj(slideInX(undefined).hidden)).toEqual({ opacity: 0, x: 24 });
  });

  it("falsy 0 is KEPT (default only triggers on undefined), not coerced to 24", () => {
    expect(obj(slideInX(0).hidden)).toEqual({ opacity: 0, x: 0 });
  });

  it("negative offset is passed through unchanged", () => {
    expect(obj(slideInX(-24).hidden)).toEqual({ opacity: 0, x: -24 });
  });

  it("returns a FRESH object per call (factory, not a shared singleton)", () => {
    expect(slideInX(1)).not.toBe(slideInX(1));
  });
});

describe("motion — slideInY default-param branch", () => {
  it("default (arg omitted) → y defaults to 24, animates to 0 on base", () => {
    expect(slideInY()).toEqual({
      hidden: { opacity: 0, y: 24 },
      show: { opacity: 1, y: 0, transition: T_BASE },
    });
  });

  it("explicit value → y is the provided offset", () => {
    expect(obj(slideInY(40).hidden)).toEqual({ opacity: 0, y: 40 });
  });

  it("falsy 0 is KEPT, not coerced to 24", () => {
    expect(obj(slideInY(0).hidden)).toEqual({ opacity: 0, y: 0 });
  });

  it("explicit undefined → falls back to the 24 default", () => {
    expect(obj(slideInY(undefined).hidden)).toEqual({ opacity: 0, y: 24 });
  });
});

describe("motion — staggerParent default-param branch", () => {
  it("default (arg omitted) → staggerChildren 0.06, empty hidden", () => {
    expect(staggerParent()).toEqual({
      hidden: {},
      show: { transition: { staggerChildren: 0.06 } },
    });
  });

  it("explicit value → staggerChildren is the provided delay", () => {
    expect(obj(staggerParent(0.2).show)).toEqual({ transition: { staggerChildren: 0.2 } });
  });

  it("falsy 0 is KEPT (no stagger), not coerced to 0.06", () => {
    expect(obj(staggerParent(0).show)).toEqual({ transition: { staggerChildren: 0 } });
  });

  it("explicit undefined → falls back to the 0.06 default", () => {
    expect(obj(staggerParent(undefined).show)).toEqual({ transition: { staggerChildren: 0.06 } });
  });
});

describe("motion — three-state page/modal variants (hidden/show/exit)", () => {
  it("pageTransition: y 8 → 0 (slow), exit y 0 → -8 (fast)", () => {
    expect(pageTransition).toEqual({
      hidden: { opacity: 0, y: 8 },
      show: { opacity: 1, y: 0, transition: T_SLOW },
      exit: { opacity: 0, y: -8, transition: T_FAST },
    });
  });

  it("modalTransition: scale+lift in (base), scale 0.98 out (fast)", () => {
    expect(modalTransition).toEqual({
      hidden: { opacity: 0, scale: 0.96, y: 8 },
      show: { opacity: 1, scale: 1, y: 0, transition: T_BASE },
      exit: { opacity: 0, scale: 0.98, y: 4, transition: T_FAST },
    });
  });

  it("exit uses the FAST preset, distinct from the SLOW enter (regression guard)", () => {
    expect(obj(pageTransition.exit).transition).toEqual(T_FAST);
    expect(obj(pageTransition.show).transition).toEqual(T_SLOW);
    expect(obj(pageTransition.exit).transition).not.toEqual(obj(pageTransition.show).transition);
  });
});
