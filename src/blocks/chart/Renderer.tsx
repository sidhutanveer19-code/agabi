"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { color, font } from "@/design-system/tokens";
import type { BlockRendererProps } from "@/workspace/blocks";
import type { ChartData } from "./schema";

const PALETTE = [color.violet2, color.cyan, color.green, color.orange, color.gold];

const axis = { stroke: color.muted2, tick: { fill: color.muted, fontSize: 12 } };
const tooltipStyle = {
  contentStyle: {
    background: "#12141c",
    border: `1px solid ${color.border}`,
    borderRadius: 10,
    fontFamily: font.sans,
    fontSize: 13,
    color: color.ink,
  },
};

export function Renderer({ data }: BlockRendererProps<ChartData>) {
  const grid = <CartesianGrid stroke={color.border} strokeDasharray="3 6" />;
  const x = <XAxis dataKey={data.xKey} stroke={axis.stroke} tick={axis.tick} />;
  const y = <YAxis stroke={axis.stroke} tick={axis.tick} width={40} />;

  return (
    <div style={{ width: "100%", height: 250, fontFamily: font.sans }}>
      <ResponsiveContainer width="100%" height="100%">
        {data.kind === "bar" ? (
          <BarChart data={data.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            {grid}
            {x}
            {y}
            <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,.04)" }} />
            <Legend />
            {data.yKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : data.kind === "area" ? (
          <AreaChart data={data.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            {grid}
            {x}
            {y}
            <Tooltip {...tooltipStyle} />
            <Legend />
            {data.yKeys.map((k, i) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stroke={PALETTE[i % PALETTE.length]}
                fill={PALETTE[i % PALETTE.length]}
                fillOpacity={0.15}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            {grid}
            {x}
            {y}
            <Tooltip {...tooltipStyle} />
            <Legend />
            {data.yKeys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
