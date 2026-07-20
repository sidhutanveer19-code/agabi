"use client";

import { useState, type ReactElement } from "react";
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  ScatterChart,
  Bar,
  Line,
  Area,
  Pie,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { color, font, radius } from "@/config/tokens";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";

export type ChartKind = "bar" | "line" | "area" | "pie" | "scatter";

export interface ChartSeries {
  key: string;
  color?: string;
}

export interface ChartData {
  kind: ChartKind;
  series: ChartSeries[];
  data: Record<string, number | string>[];
  xKey: string;
}

/** Default series palette (Agabi dark tokens) — cycled when a series omits its color. */
const PALETTE = [color.violet2, color.cyan, color.green, color.orange, color.gold, color.danger];
const colorAt = (i: number, c?: string): string => c ?? PALETTE[i % PALETTE.length];

/** Shared dark chrome for cartesian charts (bar/line/area/scatter). */
const grid = <CartesianGrid stroke={color.border} strokeDasharray="3 3" />;
const axisProps = { stroke: color.muted2, tick: { fill: color.muted, fontSize: 11, fontFamily: font.mono }, tickLine: { stroke: color.border }, axisLine: { stroke: color.border } } as const;
const tooltip = (
  <Tooltip
    cursor={{ fill: color.surfaceHover, stroke: color.border }}
    contentStyle={{ background: color.paper, border: `1px solid ${color.border}`, borderRadius: radius.sm, color: color.ink, fontFamily: font.mono, fontSize: 12 }}
    labelStyle={{ color: color.muted3 }}
    itemStyle={{ color: color.ink }}
  />
);
const legend = <Legend wrapperStyle={{ color: color.muted, fontFamily: font.mono, fontSize: 11 }} />;

/**
 * kind → chart element. A small lookup (NOT a switch): each entry builds the
 * matching Recharts chart from the same `data`. Wrapped by ResponsiveContainer.
 */
const CHARTS: Record<ChartKind, (d: ChartData) => ReactElement> = {
  bar: (d) => (
    <BarChart data={d.data}>
      {grid}
      <XAxis dataKey={d.xKey} {...axisProps} />
      <YAxis {...axisProps} />
      {tooltip}
      {legend}
      {d.series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} fill={colorAt(i, s.color)} radius={[4, 4, 0, 0]} />
      ))}
    </BarChart>
  ),
  line: (d) => (
    <LineChart data={d.data}>
      {grid}
      <XAxis dataKey={d.xKey} {...axisProps} />
      <YAxis {...axisProps} />
      {tooltip}
      {legend}
      {d.series.map((s, i) => (
        <Line key={s.key} type="monotone" dataKey={s.key} stroke={colorAt(i, s.color)} strokeWidth={2} dot={{ r: 3, fill: colorAt(i, s.color) }} activeDot={{ r: 5 }} />
      ))}
    </LineChart>
  ),
  area: (d) => (
    <AreaChart data={d.data}>
      {grid}
      <XAxis dataKey={d.xKey} {...axisProps} />
      <YAxis {...axisProps} />
      {tooltip}
      {legend}
      {d.series.map((s, i) => (
        <Area key={s.key} type="monotone" dataKey={s.key} stroke={colorAt(i, s.color)} fill={colorAt(i, s.color)} fillOpacity={0.22} strokeWidth={2} />
      ))}
    </AreaChart>
  ),
  pie: (d) => {
    const first = d.series[0]?.key ?? d.xKey;
    return (
      <PieChart>
        {tooltip}
        {legend}
        <Pie data={d.data} dataKey={first} nameKey={d.xKey} cx="50%" cy="50%" outerRadius="72%" stroke={color.paper} strokeWidth={2} label={{ fill: color.muted3, fontSize: 11, fontFamily: font.mono }}>
          {d.data.map((_, i) => (
            <Cell key={i} fill={colorAt(i, d.series[i]?.color)} />
          ))}
        </Pie>
      </PieChart>
    );
  },
  scatter: (d) => (
    <ScatterChart>
      {grid}
      <XAxis type="number" dataKey="x" name={d.xKey} {...axisProps} />
      <YAxis type="number" dataKey="y" {...axisProps} />
      <ZAxis range={[60, 60]} />
      {tooltip}
      {legend}
      {d.series.map((s, i) => (
        <Scatter
          key={s.key}
          name={s.key}
          data={d.data.map((r) => ({ x: Number(r[d.xKey]), y: Number(r[s.key]) }))}
          fill={colorAt(i, s.color)}
        />
      ))}
    </ScatterChart>
  ),
};

/** Recharts renderer (lazy-loaded). Present-only by default; JSON-editable in dev. */
export default function ChartRenderer({ block, editing, onChange }: BlockRendererProps<ChartData>) {
  const data: ChartData = block.data ?? { kind: "bar", series: [], data: [], xKey: "" };
  const build = CHARTS[data.kind] ?? CHARTS.bar;

  const [draft, setDraft] = useState<string>(() => JSON.stringify(data, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(text);
    try {
      const next = JSON.parse(text) as ChartData;
      setErr(null);
      onChange?.(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "invalid JSON");
    }
  };

  return (
    <div
      role="img"
      aria-label={`${data.kind} chart`}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${color.border}`,
        background: color.paper,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, padding: 10 }}>
        <ResponsiveContainer width="100%" height="100%">
          {build(data)}
        </ResponsiveContainer>
      </div>

      {editing ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ borderTop: `1px solid ${color.border}`, background: color.surface, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}
        >
          <textarea
            aria-label="Edit chart data JSON"
            value={draft}
            onChange={(e) => commit(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            spellCheck={false}
            rows={6}
            style={{
              width: "100%",
              resize: "vertical",
              background: color.bg,
              color: color.inkSoft,
              border: `1px solid ${err ? color.danger : color.border}`,
              borderRadius: radius.sm,
              padding: 8,
              fontFamily: font.mono,
              fontSize: 11,
              lineHeight: 1.5,
              outline: "none",
            }}
          />
          {err ? <span style={{ color: color.danger, fontFamily: font.mono, fontSize: 10 }}>{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
