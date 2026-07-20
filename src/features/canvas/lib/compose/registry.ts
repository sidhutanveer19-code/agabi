import type { Lesson } from "@/features/canvas/lib/lesson";
import { projectileLesson } from "@/features/canvas/data/lessons/projectile";
import { quadraticLesson } from "@/features/canvas/data/lessons/quadratic";
import { pythagoreanLesson } from "@/features/canvas/data/lessons/pythagorean";

interface Entry {
  keywords: string[];
  lesson: Lesson;
}

/** Hand-authored lessons matched by keyword. Highest fidelity — tried first. */
const REGISTRY: Entry[] = [
  {
    keywords: ["quadratic", "parabola", "roots", "x^2", "x²", "factoring", "vertex", "discriminant"],
    lesson: quadraticLesson,
  },
  {
    keywords: ["pythagoras", "pythagorean", "right triangle", "hypotenuse", "a2+b2", "a²+b²", "triangle"],
    lesson: pythagoreanLesson,
  },
  {
    keywords: ["ball", "thrown", "throw", "gravity", "projectile", "falling", "come back down", "newton"],
    lesson: projectileLesson,
  },
];

export function matchLesson(topic: string): Lesson | null {
  const t = topic.toLowerCase();
  for (const e of REGISTRY) {
    if (e.keywords.some((k) => t.includes(k))) return e.lesson;
  }
  return null;
}
