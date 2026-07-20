"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Size } from "@/features/workspace/types";

/**
 * Measure the pixel size of the canvas container via ResizeObserver.
 *
 * The size is set from the observer callback (async), not synchronously inside
 * the effect body, which keeps this clear of the `set-state-in-effect` lint and
 * delivers the initial measurement on the observer's first fire.
 */
export function useViewport(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
