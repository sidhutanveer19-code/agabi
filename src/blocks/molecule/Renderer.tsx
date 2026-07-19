"use client";

import { useEffect, useRef } from "react";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { MoleculeData } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any -- 3Dmol ships loose runtime types */
export function Renderer({ data }: BlockRendererProps<MoleculeData>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let raf = 0;
    let disposed = false;
    let viewer: any = null;

    import("3dmol")
      .then((mod) => {
        if (disposed || !ref.current) return;
        const $3Dmol: any = (mod as any).default ?? mod;
        viewer = $3Dmol.createViewer(ref.current, { backgroundColor: "#0a0c11" });
        viewer.addModel(data.data, data.format);
        viewer.setStyle({}, { stick: { radius: 0.14 }, sphere: { scale: 0.28 } });
        viewer.zoomTo();
        viewer.render();
        const spin = () => {
          if (disposed) return;
          viewer.rotate(0.6, "y");
          viewer.render();
          raf = requestAnimationFrame(spin);
        };
        spin();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      try {
        viewer?.clear?.();
      } catch {
        /* ignore */
      }
    };
  }, [data]);

  return (
    <div
      ref={ref}
      style={{ position: "relative", width: "100%", height: 320, borderRadius: radius.lg, overflow: "hidden" }}
    />
  );
}
