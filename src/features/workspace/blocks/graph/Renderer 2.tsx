"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import JXG from "jsxgraph";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";
import { compileExpression } from "@/features/workspace/blocks/shared/mathEval";
import { color, font, radius, space } from "@/config/tokens";

/** One plotted curve: a math expression and an optional stroke color. */
export interface GraphFunction {
  expr: string;
  color?: string;
}

/** Serialized state for a Function Graph block. Everything lives in `data`. */
export interface GraphData {
  functions: GraphFunction[];
  /** Cartesian window as [xmin, ymin, xmax, ymax]. */
  bounds: [number, number, number, number];
}

/** Board type derived from the library (no `any` leaking into module scope). */
type Board = ReturnType<typeof JXG.JSXGraph.initBoard>;

/** Cycle of accent strokes for auto-colored curves. */
const PALETTE = [color.cyan, color.violet2, color.green, color.orange, color.gold] as const;

const EMPTY: GraphData = { functions: [], bounds: [-6, -4, 6, 4] };

/**
 * Compile a user expression to a numeric x→y function using the safe evaluator
 * (no eval / Function). `^` is exponentiation; sin/cos/sqrt/… and pi/e are in
 * scope. Returns null when the expression can't be parsed.
 */
function compile(expr: string): ((x: number) => number) | null {
  return compileExpression(expr);
}

/**
 * JSXGraph cartesian plotter (lazy-loaded). Renders one functiongraph per
 * expression; editable via a textarea (one expr per line) in dev, static in
 * present mode. Board is freed on unmount / re-init to avoid leaks.
 */
export default function GraphRenderer({ block, editing, onChange }: BlockRendererProps<GraphData>) {
  const data = block.data ?? EMPTY;
  const functions = useMemo(() => data.functions ?? [], [data.functions]);
  const bounds = useMemo(() => data.bounds ?? EMPTY.bounds, [data.bounds]);

  const divId = `agabi-graph-${block.id}-${useId().replace(/[:]/g, "")}`;
  const boardRef = useRef<Board | null>(null);

  // Keys that, when changed, require a board rebuild.
  const fnKey = useMemo(() => JSON.stringify(functions), [functions]);
  const boundsKey = useMemo(() => JSON.stringify(bounds), [bounds]);

  useEffect(() => {
    const [xmin, ymin, xmax, ymax] = bounds;
    // JSXGraph boundingbox is [left, top, right, bottom] = [xmin, ymax, xmax, ymin].
    const axisStyle = {
      strokeColor: color.muted2,
      highlightStrokeColor: color.muted,
      ticks: {
        strokeColor: color.border,
        majorHeight: 8,
        label: { fontSize: 10, strokeColor: color.muted, cssStyle: `font-family:${font.mono}` },
      },
    };

    const board = JXG.JSXGraph.initBoard(divId, {
      boundingbox: [xmin, ymax, xmax, ymin],
      axis: true,
      showNavigation: false,
      showCopyright: false,
      showInfobox: false,
      keepAspectRatio: false,
      pan: { enabled: false },
      zoom: { wheel: false, needShift: true },
      grid: true,
      defaultAxes: { x: axisStyle, y: axisStyle },
    });
    boardRef.current = board;

    board.suspendUpdate();
    functions.forEach((f, i) => {
      const fn = compile(f.expr);
      if (!fn) return;
      try {
        board.create("functiongraph", [fn], {
          strokeColor: f.color ?? PALETTE[i % PALETTE.length],
          strokeWidth: 2.25,
          highlight: false,
          fixed: true,
          name: "",
          withLabel: false,
        });
      } catch {
        /* skip malformed expression */
      }
    });
    board.unsuspendUpdate();

    return () => {
      if (boardRef.current) {
        JXG.JSXGraph.freeBoard(boardRef.current);
        boardRef.current = null;
      }
    };
    // divId is stable per instance; rebuild when curves or window change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divId, fnKey, boundsKey]);

  const label =
    functions.length > 0
      ? `Function graph plotting ${functions.map((f) => f.expr).join(", ")}`
      : "Empty function graph";

  const applyText = (text: string) => {
    const exprs = text.split("\n");
    const next: GraphFunction[] = exprs.map((line, i) => ({
      expr: line,
      color: functions[i]?.color ?? PALETTE[i % PALETTE.length],
    }));
    onChange?.({ ...data, functions: next });
  };

  return (
    <div
      role="img"
      aria-label={label}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius.lg,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <div
        id={divId}
        style={{ position: "absolute", inset: 0, background: color.paper, touchAction: "none" }}
      />

      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: space[2],
            bottom: space[2],
            right: space[2],
            display: "flex",
            flexDirection: "column",
            gap: space[1],
            padding: space[2],
            borderRadius: radius.md,
            background: "rgba(10,12,17,0.86)",
            border: `1px solid ${color.border}`,
            backdropFilter: "blur(6px)",
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: color.muted,
            }}
          >
            functions — one per line (use ^ for power)
          </span>
          <textarea
            aria-label="Edit graph functions, one expression per line"
            spellCheck={false}
            defaultValue={functions.map((f) => f.expr).join("\n")}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => applyText(e.target.value)}
            rows={Math.min(Math.max(functions.length, 1), 5)}
            style={{
              width: "100%",
              resize: "vertical",
              boxSizing: "border-box",
              padding: space[2],
              borderRadius: radius.sm,
              border: `1px solid ${color.border}`,
              background: color.surface,
              color: color.ink,
              fontFamily: font.mono,
              fontSize: 12.5,
              lineHeight: 1.5,
              outline: "none",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
