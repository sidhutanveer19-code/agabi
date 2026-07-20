"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Size } from "@/features/workspace/types";

/**
 * Live size of a container element via ResizeObserver. SSR-safe (starts 0×0).
 * The observer's first callback delivers the initial size asynchronously, so no
 * state is set synchronously inside the effect.
 */
export function useViewport(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return size;
}
