import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { buildAdj, bfsWithParents, reconstructPath } from "./_graph-utils.js";

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
  const topN = Math.max(5, Math.min(50, Number(params.top_n ?? 15)));

  const kg = JSON.parse(readFileSync(kgPath, "utf-8")) as Kg;
  const targetRel = target ? relative(root, resolve(root, target)) : "";

  const edges = kg.edges ?? [];

  if (mode === "impact") {
    // impact = reverse dependency closure based on imports + references
    const inAdj = buildAdj(edges as any, "in");
    const { nodes, parent } = bfsWithParents(targetRel, inAdj, depth);
    const impactedAll = nodes.filter((n) => n !== targetRel);
    const impacted = impactedAll.slice(0, topN);
    const paths = impacted.map((n) => ({
      node: n,
      path: reconstructPath(n, parent),
    }));
    return textResult(
      JSON.stringify({
        mode,
        target: targetRel,
        depth,
        impacted,
        impacted_count: impactedAll.length,
        paths,
        kg_generated_at: kg.generated_at,
      }),
    );
  }

  if (mode === "deps") {
    const outAdj = buildAdj(edges as any, "out");
    const { nodes, parent } = bfsWithParents(targetRel, outAdj, depth);
    const depsAll = nodes.filter((n) => n !== targetRel);
    const deps = depsAll.slice(0, topN);
    const paths = deps.map((n) => ({
      node: n,
      path: reconstructPath(n, parent),
    }));
    return textResult(
      JSON.stringify({
        mode,
        target: targetRel,
        depth,
        deps,
        deps_count: depsAll.length,
        paths,
        kg_generated_at: kg.generated_at,
      }),
    );
  }

  if (mode === "symbol") {
    const sym = String(params.symbol ?? "").trim();
    if (!sym) return errorResult("symbol is required when mode=symbol");
    const def = kg.symbols.find((s) => s.name === sym);
    if (!def) return errorResult(`symbol not found: ${sym}`);

    const inAdjRef = buildAdj(edges as any, "in", "references");
    const { nodes } = bfsWithParents(def.file, inAdjRef, depth);
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
