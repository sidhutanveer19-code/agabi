"use client";

import { useEffect, useId, useRef } from "react";
import JXG from "jsxgraph";
import { radius } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { InteractiveMathData } from "./schema";

export function Renderer(_props: BlockRendererProps<InteractiveMathData>) {
  const id = "jxg-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.id = id;
    const board = JXG.JSXGraph.initBoard(id, {
      boundingbox: [-5, 6, 5, -2],
      axis: true,
      showCopyright: false,
      showNavigation: false,
    });
    const a = board.create("slider", [[-4, 5], [0, 5], [-3, 1, 3]], { name: "a" });
    board.create("functiongraph", [(x: number) => a.Value() * x * x], {
      strokeColor: "#7c3aed",
      strokeWidth: 2.5,
    });
    return () => JXG.JSXGraph.freeBoard(board);
  }, [id]);

  return (
    <div
      ref={ref}
      style={{ width: "100%", height: 320, borderRadius: radius.lg, overflow: "hidden", background: "#fbfbfb" }}
    />
  );
}
