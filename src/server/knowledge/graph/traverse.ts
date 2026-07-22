import type { TraversalResult } from "@/server/knowledge/types";

/**
 * Neutral, pure graph primitives shared by all three graph modules. This file imports
 * NONE of dependency/composition/reinforcement — so a graph module importing it does
 * not breach W6/W7 (which forbid the three graphs importing each OTHER, not shared
 * infrastructure). Everything here takes edges as plain data; nothing touches a store.
 */

export interface Edge {
  from: string;
  to: string;
}
/** Adjacency in traversal direction: node id → the ids reachable in one hop. */
export type Adjacency = (nodeId: string) => string[];

export function adjacencyFrom(edges: Edge[], direction: "forward" | "reverse"): Adjacency {
  const map = new Map<string, string[]>();
  for (const e of edges) {
    const [k, v] = direction === "forward" ? [e.from, e.to] : [e.to, e.from];
    (map.get(k) ?? map.set(k, []).get(k)!).push(v);
  }
  return (id) => map.get(id) ?? [];
}

/**
 * Bounded BFS (§18B.1/.2). `maxDepth` and `maxNodes` are mandatory — an unbounded walk
 * over a graph that has accidentally acquired a cycle is a production hang. A visited-set
 * doubles as the §18B.2 path guard: a cycle terminates instead of looping. Truncation is
 * REPORTED, never silent — a cap the caller does not know about looks like full coverage.
 */
export function boundedTraverse(
  seeds: string[],
  adjacency: Adjacency,
  maxDepth: number,
  maxNodes: number,
): TraversalResult {
  const seen = new Map<string, number>();
  let truncated = false;
  const queue: { id: string; depth: number }[] = [];
  for (const s of seeds) {
    if (!seen.has(s)) {
      seen.set(s, 0);
      queue.push({ id: s, depth: 0 });
    }
  }
  let head = 0;
  while (head < queue.length) {
    const { id, depth } = queue[head++];
    if (depth >= maxDepth) continue;
    for (const next of adjacency(id)) {
      if (seen.has(next)) continue;
      if (seen.size >= maxNodes) {
        truncated = true;
        break;
      }
      seen.set(next, depth + 1);
      queue.push({ id: next, depth: depth + 1 });
    }
    if (truncated) break;
  }
  const nodes = [...seen.entries()].map(([id, depth]) => ({ id, depth }));
  return { nodes, truncated };
}

/** Returns a cycle path if the directed graph has one, else null. */
export function detectCycle(edges: Edge[]): string[] | null {
  const adj = adjacencyFrom(edges, "forward");
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(n: string): string[] | null {
    color.set(n, GRAY);
    stack.push(n);
    for (const m of adj(n)) {
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) return [...stack.slice(stack.indexOf(m)), m]; // back-edge → the cycle
      if (c === WHITE) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(n, BLACK);
    return null;
  }

  for (const n of [...nodes].sort()) {
    if ((color.get(n) ?? WHITE) === WHITE) {
      const found = visit(n);
      if (found) return found;
    }
  }
  return null;
}

/** True when adding `from→to` would close a cycle in the existing edge set. */
export function wouldCreateCycle(edges: Edge[], from: string, to: string): boolean {
  if (from === to) return true;
  // Reachable from `to` already containing `from` ⇒ from→to closes a loop.
  const adj = adjacencyFrom(edges, "forward");
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    for (const m of adj(n)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return false;
}

/**
 * Kahn topological sort with DETERMINISTIC tie-breaking (§18B.3). An edge {from,to}
 * means "from must come before to". Ties resolved by `tieBreak` (default: id order),
 * so identical graph + seeds always produce identical order — required for a replayable
 * `selectPath`. Returns `hasCycle: true` (and a partial order) if the graph is not a DAG.
 */
export function kahnTopoSort(
  edges: Edge[],
  tieBreak: (a: string, b: string) => number = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
): { order: string[]; hasCycle: boolean } {
  const nodes = new Set<string>();
  const outAdj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  for (const n of nodes) indeg.set(n, 0);
  for (const e of edges) {
    (outAdj.get(e.from) ?? outAdj.set(e.from, []).get(e.from)!).push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const ready = [...nodes].filter((n) => (indeg.get(n) ?? 0) === 0).sort(tieBreak);
  const order: string[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const m of (outAdj.get(n) ?? []).sort(tieBreak)) {
      const d = (indeg.get(m) ?? 0) - 1;
      indeg.set(m, d);
      if (d === 0) {
        // insert keeping `ready` sorted so tie-breaking is stable
        const i = ready.findIndex((x) => tieBreak(m, x) < 0);
        if (i === -1) ready.push(m);
        else ready.splice(i, 0, m);
      }
    }
  }
  return { order, hasCycle: order.length !== nodes.size };
}
