import type { CSSProperties } from "react";
import {
  resolveContent,
  type GroupNode,
  type Leaf,
  type Lesson,
  type MarkerId,
  type PathNode,
  type VariantSlots,
} from "@/features/canvas/lib/lesson";

type Inherit = Partial<Pick<PathNode, "stroke" | "w" | "cap" | "join" | "fill">>;

function drawStyle(dl?: number, dur?: number): CSSProperties {
  const s: Record<string, string> = {};
  if (dl != null) s["--dl"] = `${dl}s`;
  if (dur != null) s["--d"] = `${dur}s`;
  return s as CSSProperties;
}

function marker(m?: MarkerId): string | undefined {
  return m ? `url(#e2${m})` : undefined;
}

function renderPath(
  n: PathNode,
  key: string,
  slots: VariantSlots,
  inherit: Inherit,
  animClass?: string
) {
  const stroke = n.stroke ?? inherit.stroke;
  const w = n.w ?? inherit.w;
  const cap = n.cap ?? inherit.cap;
  const join = n.join ?? inherit.join;
  const fill = n.fill ?? inherit.fill ?? "none";
  const isStrokeAnim = animClass === "stroke";
  return (
    <path
      key={key}
      className={animClass}
      style={animClass ? drawStyle(n.dl, n.dur) : undefined}
      d={n.d}
      stroke={stroke}
      strokeWidth={w}
      fill={fill}
      opacity={n.opacity}
      strokeLinecap={cap ? "round" : undefined}
      strokeLinejoin={join ? "round" : undefined}
      strokeDasharray={!isStrokeAnim ? n.dash : undefined}
      markerEnd={marker(n.marker)}
      pathLength={isStrokeAnim ? 1 : undefined}
    />
  );
}

function renderLeaf(
  n: Leaf,
  key: string,
  slots: VariantSlots,
  inherit: Inherit,
  topAnim?: string
) {
  switch (n.t) {
    case "path":
      return renderPath(n, key, slots, inherit, topAnim);
    case "text":
      return (
        <text
          key={key}
          x={n.x}
          y={n.y}
          fill={n.fill}
          fontSize={n.size}
          textAnchor={n.anchor}
        >
          {resolveContent(n.content, slots)}
        </text>
      );
    case "circle":
      return (
        <circle
          key={key}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          fill={n.fill ?? inherit.fill}
          stroke={n.stroke ?? inherit.stroke}
          strokeWidth={n.w ?? inherit.w}
        />
      );
    case "rect":
      return (
        <rect
          key={key}
          x={n.x}
          y={n.y}
          width={n.w}
          height={n.h}
          rx={n.rx}
          fill={n.fill}
          stroke={n.stroke}
          strokeWidth={n.sw}
        />
      );
  }
}

function renderGroup(g: GroupNode, key: string, slots: VariantSlots) {
  const inherit: Inherit = {
    stroke: g.stroke,
    w: g.w,
    cap: g.cap,
    join: g.join,
    fill: g.fill,
  };
  const cls = `${g.hand ? "hw " : ""}${g.kind}`;
  return (
    <g key={key} className={cls} style={drawStyle(g.dl, g.dur)}>
      {g.children.map((c, i) => renderLeaf(c, `${key}-${i}`, slots, inherit))}
    </g>
  );
}

export default function TeachingBoard({
  lesson,
  slots,
  drawing,
  paused,
}: {
  lesson: Lesson;
  slots: VariantSlots;
  drawing: boolean;
  paused: boolean;
}) {
  const boardCls = `board${drawing ? " draw" : ""}${paused ? " paused" : ""}`;
  return (
    <div
      className={boardCls}
      style={{
        position: "relative",
        zIndex: 1,
        flex: 1,
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 18px",
      }}
    >
      <svg
        viewBox={lesson.viewBox}
        role="img"
        aria-label={`${lesson.subject} lesson: ${lesson.title}. ${slots.subtitle}`}
        style={{ width: "100%", maxWidth: 1240, height: "auto", display: "block" }}
      >
        <title>{lesson.title}</title>
        <desc>{slots.subtitle}</desc>
        <defs>
          {(
            [
              ["V", "#A78BFA"],
              ["O", "#E8944E"],
              ["G", "#6FCF97"],
              ["W", "#EDE8DF"],
            ] as const
          ).map(([id, color]) => (
            <marker
              key={id}
              id={`e2${id}`}
              markerWidth="12"
              markerHeight="12"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path
                d="M0,0 L8,4 L0,8"
                fill="none"
                stroke={color}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          ))}
        </defs>

        {lesson.nodes.map((n, i) => {
          const key = `n${i}`;
          if (n.t === "group") return renderGroup(n, key, slots);
          if (n.t === "path")
            return renderPath(n, key, slots, {}, n.kind);
          return renderLeaf(n, key, slots, {});
        })}
      </svg>
    </div>
  );
}
