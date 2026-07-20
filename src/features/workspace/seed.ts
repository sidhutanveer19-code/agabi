import { color } from "@/config/tokens";
import type { Region } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";

/**
 * Region-streaming simulation used ONLY to verify the engine on /workspace.
 * This is not the AI — it exercises the same `createRegion` + `addBlock` API the
 * AI will later use to stream teaching into fresh regions (never overwriting).
 */
const ACCENTS = [color.violet2, color.cyan, color.green, color.orange, color.gold];

const PARAGRAPHS = [
  "This is the first pass at the idea — a fresh explanation region on the infinite canvas.",
  "Each explanation lives in its own region. Interrupting starts a new one; nothing is ever deleted.",
  "You can pan, zoom, and compare explanations side by side across the whole workspace.",
];

/** Create one explanation region populated with foundational text blocks. */
export function seedExplanation(title: string, index = 0): Region {
  const store = useWorkspaceStore.getState();
  const id = store.createRegion(title, { accent: ACCENTS[index % ACCENTS.length] });
  const region = useWorkspaceStore.getState().doc.regions.find((r) => r.id === id);
  const width = (region?.size.w ?? 640) - 32;
  let y = 52;
  for (const text of PARAGRAPHS) {
    store.addBlock(id, { type: "text", position: { x: 16, y }, size: { w: width, h: 80 }, data: { text } });
    y += 92;
  }
  const created = useWorkspaceStore.getState().doc.regions.find((r) => r.id === id);
  return created as Region;
}

/** Stress the virtualizer: many regions × many blocks (default ≈ 1000 blocks). */
export function stressSeed(regionCount = 40, blocksPerRegion = 25): void {
  const store = useWorkspaceStore.getState();
  for (let i = 0; i < regionCount; i++) {
    const id = store.createRegion(`Region ${i + 1}`, { accent: ACCENTS[i % ACCENTS.length] });
    for (let b = 0; b < blocksPerRegion; b++) {
      const col = b % 5;
      const row = Math.floor(b / 5);
      store.addBlock(id, {
        type: "text",
        position: { x: 16 + col * 120, y: 52 + row * 70 },
        size: { w: 110, h: 60 },
        data: { text: `#${b + 1}` },
      });
    }
  }
}
