import type { Transition, Variants } from "motion/react";
import { motion, duration } from "@/config/tokens";

const ease = motion.ease;

/** Shared transition presets (seconds + the Agabi easing). */
export const transition = {
  fast: { duration: duration.fast, ease } satisfies Transition,
  base: { duration: duration.base, ease } satisfies Transition,
  slow: { duration: duration.slow, ease } satisfies Transition,
  slower: { duration: duration.slower, ease } satisfies Transition,
} as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: transition.slow },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease } },
};

export const paperIn: Variants = {
  hidden: { opacity: 0, scale: 1.03 },
  show: { opacity: 1, scale: 1, transition: transition.slower },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: transition.base },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: { opacity: 1, scale: 1, transition: transition.base },
};

export const slideInX = (x = 24): Variants => ({
  hidden: { opacity: 0, x },
  show: { opacity: 1, x: 0, transition: transition.base },
});

export const slideInY = (y = 24): Variants => ({
  hidden: { opacity: 0, y },
  show: { opacity: 1, y: 0, transition: transition.base },
});

export const staggerParent = (stagger = 0.06): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger } },
});

/** Page-level enter/exit for route or phase transitions. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: transition.slow },
  exit: { opacity: 0, y: -8, transition: transition.fast },
};

/** Modal/overlay enter/exit. */
export const modalTransition: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: transition.base },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: transition.fast },
};
