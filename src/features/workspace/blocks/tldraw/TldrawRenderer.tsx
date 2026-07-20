"use client";

import { useCallback, useRef } from "react";
import { Tldraw, getSnapshot, loadSnapshot, type Editor, type TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import type { BlockRendererProps } from "@/features/workspace/blocks/types";

export interface TldrawData {
  snapshot: Partial<TLEditorSnapshot> | null;
}

/** tldraw renderer (lazy-loaded). The workspace owns positioning; tldraw only draws. */
export default function TldrawRenderer({ block, editing, onChange }: BlockRendererProps<TldrawData>) {
  const data = block.data ?? { snapshot: null };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMount = useCallback(
    (editor: Editor) => {
      if (data.snapshot) {
        try {
          loadSnapshot(editor.store, data.snapshot);
        } catch {
          /* corrupt snapshot — start fresh */
        }
      }
      editor.updateInstanceState({ isReadonly: !editing });
      if (editing) {
        editor.store.listen(
          () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => onChange?.({ snapshot: getSnapshot(editor.store) }), 500);
          },
          { scope: "document", source: "user" }
        );
      }
    },
    // one-time mount wiring
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing]
  );

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 14, overflow: "hidden", position: "relative" }}>
      <Tldraw onMount={onMount} hideUi={!editing} />
    </div>
  );
}
