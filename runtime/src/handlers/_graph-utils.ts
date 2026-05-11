export type Edge = { from: string; to: string; type?: string };

export function buildAdj(
  edges: Edge[],
  direction: "out" | "in",
  type?: string,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    if (type && e.type !== type) continue;
    const a = direction === "out" ? e.from : e.to;
    const b = direction === "out" ? e.to : e.from;
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  }
  return m;
}

export function bfsWithParents(
  start: string,
  adj: Map<string, Set<string>>,
  depth: number,
): {
  nodes: string[];
  parent: Map<string, string | null>;
  dist: Map<string, number>;
} {
  const parent = new Map<string, string | null>();
  const dist = new Map<string, number>();

  parent.set(start, null);
  dist.set(start, 0);

  const q: string[] = [start];

  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur) ?? 0;
    if (d >= depth) continue;

    for (const nxt of adj.get(cur) ?? []) {
      if (dist.has(nxt)) continue;
      parent.set(nxt, cur);
      dist.set(nxt, d + 1);
      q.push(nxt);
    }
  }

  return { nodes: Array.from(dist.keys()), parent, dist };
}

export function reconstructPath(
  target: string,
  parent: Map<string, string | null>,
): string[] {
  if (!parent.has(target)) return [];
  const path: string[] = [];
  let cur: string | null = target;
  while (cur) {
    path.push(cur);
    cur = parent.get(cur) ?? null;
  }
  path.reverse();
  return path;
}
