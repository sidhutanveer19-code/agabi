"use client";

import { useMemo } from "react";
import { z } from "zod";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { color, font, radius } from "@/design-system/tokens";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

type Row = Record<string, string | number>;

const schema = z.object({
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});
type Data = z.infer<typeof schema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  const columns = useMemo<ColumnDef<Row>[]>(
    () => data.columns.map((c) => ({ accessorKey: c.key, header: c.label })),
    [data.columns]
  );
  const table = useReactTable({
    data: data.rows as Row[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      className="ds-scroll"
      style={{
        overflow: "auto",
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        background: color.surface,
        fontFamily: font.sans,
      }}
    >
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    color: color.muted3,
                    borderBottom: `1px solid ${color.border}`,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  style={{
                    padding: "9px 14px",
                    color: color.inkDim,
                    borderBottom: `1px solid ${color.border}`,
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const tableBlock = defineBlock<Data>({
  type: "table",
  label: "Table",
  category: "data",
  defaultSize: { w: 560, h: 200 },
  schema,
  Renderer,
  sample: {
    columns: [
      { key: "planet", label: "Planet" },
      { key: "moons", label: "Moons" },
      { key: "day", label: "Day (hrs)" },
    ],
    rows: [
      { planet: "Earth", moons: 1, day: 24 },
      { planet: "Mars", moons: 2, day: 25 },
      { planet: "Jupiter", moons: 95, day: 10 },
    ],
  },
});
