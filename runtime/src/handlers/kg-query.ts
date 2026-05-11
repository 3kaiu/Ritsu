import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";

type EdgeType = "imports" | "references";

type KgEdge = {
  from: string;
  to: string;
  type: EdgeType;
};

type Kg = {
  version: string;
  generated_at: string;
  root: string;
  files: string[];
  edges: KgEdge[];
  symbols: Array<{ name: string; kind: string; file: string }>;
};

function buildAdj(edges: KgEdge[], direction: "out" | "in", type?: EdgeType) {
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

function bfs(start: string[], adj: Map<string, Set<string>>, depth: number): string[] {
  const seen = new Set<string>();
  const q: Array<{ n: string; d: number }> = [];
  for (const s of start) {
    seen.add(s);
    q.push({ n: s, d: 0 });
  }

  while (q.length) {
    const cur = q.shift()!;
    if (cur.d >= depth) continue;
    for (const nxt of adj.get(cur.n) ?? []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      q.push({ n: nxt, d: cur.d + 1 });
    }
  }

  return Array.from(seen);
}

export async function ritsu_query_kg(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const kgPath = resolve(root, ".ritsu", "kg.json");
  if (!existsSync(kgPath)) {
    return errorResult("kg.json not found. Run ritsu_build_kg first.");
  }

  const target = String(params.target ?? "");
  const depth = Math.max(1, Math.min(10, Number(params.depth ?? 3)));
  const mode = String(params.mode ?? "impact");

  const kg = JSON.parse(readFileSync(kgPath, "utf-8")) as Kg;
  const targetRel = target ? relative(root, resolve(root, target)) : "";

  const edges = kg.edges ?? [];

  if (mode === "impact") {
    // impact = reverse dependency closure based on imports + references
    const inAdj = buildAdj(edges, "in");
    const nodes = bfs([targetRel], inAdj, depth);
    const impacted = nodes.filter((n) => n !== targetRel);
    return textResult(
      JSON.stringify({
        mode,
        target: targetRel,
        depth,
        impacted,
        impacted_count: impacted.length,
        kg_generated_at: kg.generated_at,
      }),
    );
  }

  if (mode === "deps") {
    const outAdj = buildAdj(edges, "out");
    const nodes = bfs([targetRel], outAdj, depth);
    const deps = nodes.filter((n) => n !== targetRel);
    return textResult(
      JSON.stringify({
        mode,
        target: targetRel,
        depth,
        deps,
        deps_count: deps.length,
        kg_generated_at: kg.generated_at,
      }),
    );
  }

  if (mode === "symbol") {
    const sym = String(params.symbol ?? "").trim();
    if (!sym) return errorResult("symbol is required when mode=symbol");
    const def = kg.symbols.find((s) => s.name === sym);
    if (!def) return errorResult(`symbol not found: ${sym}`);

    const inAdjRef = buildAdj(edges, "in", "references");
    const nodes = bfs([def.file], inAdjRef, depth);
    const callers = nodes.filter((n) => n !== def.file);

    return textResult(
      JSON.stringify({
        mode,
        symbol: sym,
        defined_in: def.file,
        depth,
        callers,
        callers_count: callers.length,
        kg_generated_at: kg.generated_at,
      }),
    );
  }

  return errorResult(`unknown mode: ${mode}`);
}
