"use client";

import { z } from "zod";
import { useRef } from "react";
import { Table as TableIcon, Plus, X } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { color, font, radius } from "@/config/tokens";

export interface TableData {
  headers: string[];
  rows: string[][];
  colWidths: number[];
}

const schema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  colWidths: z.array(z.number()),
}) as z.ZodType<TableData>;

const DEFAULT_W = 140;

function TableBlock({ block, editing, onChange }: BlockRendererProps<TableData>) {
  const data = block.data ?? { headers: ["Column"], rows: [[""]], colWidths: [DEFAULT_W] };
  const { headers, rows } = data;
  const widths = headers.map((_, i) => data.colWidths?.[i] ?? DEFAULT_W);
  const resizing = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const patch = (p: Partial<TableData>) => onChange?.({ ...data, ...p });
  const setHeader = (c: number, v: string) => patch({ headers: headers.map((h, i) => (i === c ? v : h)) });
  const setCell = (r: number, c: number, v: string) =>
    patch({ rows: rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)) });
  const addRow = () => patch({ rows: [...rows, headers.map(() => "")] });
  const addCol = () => patch({ headers: [...headers, "Column"], rows: rows.map((row) => [...row, ""]), colWidths: [...widths, DEFAULT_W] });
  const removeRow = (r: number) => rows.length > 1 && patch({ rows: rows.filter((_, i) => i !== r) });
  const removeCol = (c: number) =>
    headers.length > 1 &&
    patch({ headers: headers.filter((_, i) => i !== c), rows: rows.map((row) => row.filter((_, i) => i !== c)), colWidths: widths.filter((_, i) => i !== c) });

  const onResizeDown = (col: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = { col, startX: e.clientX, startW: widths[col] };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    const w = Math.max(60, r.startW + (e.clientX - r.startX));
    patch({ colWidths: widths.map((cw, i) => (i === r.col ? w : cw)) });
  };
  const onResizeUp = () => { resizing.current = null; };

  const cellBase: React.CSSProperties = {
    border: `1px solid ${color.border}`,
    padding: 0,
    verticalAlign: "top",
  };
  const fieldStyle = (header: boolean): React.CSSProperties => ({
    width: "100%",
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    outline: "none",
    color: header ? color.inkBright : color.inkSoft,
    fontFamily: font.sans,
    fontWeight: header ? 600 : 400,
    fontSize: 13.5,
    padding: "8px 10px",
  });

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 4 }} onPointerMove={editing ? onResizeMove : undefined} onPointerUp={editing ? onResizeUp : undefined}>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", background: color.paper, borderRadius: radius.sm }}>
        <thead>
          <tr>
            {headers.map((h, c) => (
              <th key={c} style={{ ...cellBase, width: widths[c], position: "relative", background: color.surface }}>
                {editing ? (
                  <input value={h} onChange={(e) => setHeader(c, e.target.value)} onPointerDown={(e) => e.stopPropagation()} style={fieldStyle(true)} aria-label={`column ${c + 1} header`} />
                ) : (
                  <div style={fieldStyle(true)}>{h}</div>
                )}
                {editing && (
                  <>
                    <span onPointerDown={onResizeDown(c)} style={{ position: "absolute", top: 0, right: -3, width: 6, height: "100%", cursor: "col-resize" }} aria-hidden />
                    {headers.length > 1 && (
                      <button type="button" onClick={() => removeCol(c)} onPointerDown={(e) => e.stopPropagation()} aria-label="remove column" style={miniBtn}><X size={11} /></button>
                    )}
                  </>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ ...cellBase, width: widths[c], position: "relative" }}>
                  {editing ? (
                    <input value={cell} onChange={(e) => setCell(r, c, e.target.value)} onPointerDown={(e) => e.stopPropagation()} style={fieldStyle(false)} aria-label={`row ${r + 1} column ${c + 1}`} />
                  ) : (
                    <div style={fieldStyle(false)}>{cell}</div>
                  )}
                  {editing && c === 0 && rows.length > 1 && (
                    <button type="button" onClick={() => removeRow(r)} onPointerDown={(e) => e.stopPropagation()} aria-label="remove row" style={{ ...miniBtn, left: -22, right: "auto" }}><X size={11} /></button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={addRow} style={addBtn}><Plus size={12} /> Row</button>
          <button type="button" onClick={addCol} style={addBtn}><Plus size={12} /> Column</button>
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  position: "absolute",
  top: -9,
  right: -9,
  width: 18,
  height: 18,
  borderRadius: 999,
  border: `1px solid ${color.border}`,
  background: color.paper,
  color: color.muted3,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

const addBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${color.border}`,
  background: color.surface,
  color: color.muted3,
  fontFamily: font.sans,
  fontSize: 12,
  cursor: "pointer",
};

export function registerTableBlock(): void {
  if (hasBlock("table")) return;
  const def: BlockDefinition<TableData> = {
    type: "table",
    label: "Table",
    category: "data",
    icon: TableIcon,
    version: 1,
    component: TableBlock,
    schema,
    create: () => ({ headers: ["Column A", "Column B"], rows: [["", ""], ["", ""]], colWidths: [DEFAULT_W, DEFAULT_W] }),
    defaultSize: { w: 420, h: 200 },
    interactive: true,
    resizable: true,
    keywords: ["table", "grid", "rows", "columns"],
  };
  registerBlock(def);
}
