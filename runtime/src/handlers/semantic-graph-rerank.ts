import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { cosineSimilarity, getEmbedder } from "./_semantic-embed.js";
import { bfsWithParents, reconstructPath } from "./_graph-utils.js";

type SemanticIndexEntry = {
  id: string;
  artifact_type: string;
  artifact_layer?: string;
  path: string;
  chunk_index: number;
  heading?: string;
  chunk_start?: number;
  chunk_end?: number;
  content_hash: string;
  embedding: number[];
  created_at: string;
};

type SemanticIndexFile = {
  version: 1;
  embedder_model: string;
  dim: number;
  entries: SemanticIndexEntry[];
};

type KgEdge = { from: string; to: string; type?: string };

type Kg = {
  version: string;
  generated_at: string;
  root: string;
  files: string[];
  edges: KgEdge[];
};

type Match = {
  score: number;
  semantic_score: number;
  kg_score: number;
  path: string;
  artifact_type: string;
  artifact_layer: string;
  chunk_index: number;
  heading?: string;
  snippet: string;
  kg_best_path?: string[];
};

function loadSemanticIndex(indexPath: string): SemanticIndexFile {
  const raw = readFileSync(indexPath, "utf-8");
  const parsed = JSON.parse(raw) as SemanticIndexFile;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("invalid semantic index file");
  }
  return parsed;
}

function loadKg(kgPath: string): Kg {
  const raw = readFileSync(kgPath, "utf-8");
  const parsed = JSON.parse(raw) as Kg;
  if (!parsed || !Array.isArray(parsed.edges)) {
    throw new Error("invalid kg file");
  }
  return parsed;
}

function getSnippetByOffset(path: string, start: number, end: number): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const s = Math.max(0, Math.min(start, content.length));
  const e = Math.max(s, Math.min(end, content.length));
  return content.slice(s, e).replace(/\s+/g, " ").trim();
}

function getLegacySnippet(path: string, chunkIndex: number, chunkSize: number, overlap: number): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const clean = content.trim();
  if (!clean) return "";
  const step = Math.max(1, chunkSize - overlap);
  const start = Math.max(0, chunkIndex * step);
  const end = Math.min(clean.length, start + chunkSize);
  return clean.slice(start, end).replace(/\s+/g, " ").trim();
}

function buildUndirectedAdj(edges: KgEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  return adj;
}

function extractFileLikeTokens(text: string): string[] {
  const out = new Set<string>();
  // Prefer relative paths that look like repo files.
  for (const m of text.matchAll(/\b[\w@./-]+\.(ts|tsx|js|jsx|json|yaml|yml|toml|md)\b/g)) {
    out.add(m[0]);
  }
  return Array.from(out);
}

function toRelPath(root: string, p: string): string {
  // If already relative, keep.
  if (!p.startsWith("/") && !p.includes(":\\")) return p;
  return relative(root, resolve(root, p));
}

function computeKgScore(
  adj: Map<string, Set<string>>,
  focus: string[],
  candidates: string[],
  maxDepth: number,
): { kg_score: number; best_path: string[] | undefined } {
  if (focus.length === 0 || candidates.length === 0) return { kg_score: 0, best_path: undefined };

  let best = { score: 0, path: undefined as string[] | undefined };

  for (const f of focus) {
    const { dist, parent } = bfsWithParents(f, adj, maxDepth);
    for (const c of candidates) {
      const d = dist.get(c);
      if (typeof d !== "number") continue;
      const score = 1 / (1 + d);
      if (score > best.score) {
        best.score = score;
        best.path = reconstructPath(c, parent);
      }
    }
  }

  return { kg_score: best.score, best_path: best.path };
}

export async function ritsu_semantic_graph_rerank(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const query = String(params.query ?? "").trim();
  if (!query) return errorResult("query is required");

  const topK = Math.min(Number(params.top_k ?? 5), 50);
  const types = Array.isArray(params.types)
    ? (params.types as unknown[]).map((x) => String(x))
    : [];
  const layers = Array.isArray(params.layers)
    ? (params.layers as unknown[]).map((x) => String(x))
    : [];

  const focusPaths = Array.isArray(params.focus_paths)
    ? (params.focus_paths as unknown[]).map((x) => String(x)).filter(Boolean)
    : [];

  const chunkSize = Math.min(Number(params.chunk_size ?? 1200), 4000);
  const overlap = Math.min(Number(params.chunk_overlap ?? 200), 1000);

  const semanticWeight = Math.max(0, Math.min(1, Number(params.semantic_weight ?? 0.7)));
  const kgWeight = Math.max(0, Math.min(1, Number(params.kg_weight ?? 0.3)));
  const maxDepth = Math.max(1, Math.min(10, Number(params.kg_depth ?? 4)));

  const indexPath = resolve(root, ".ritsu", "semantic-index.json");
  if (!existsSync(indexPath)) {
    return errorResult(`semantic index not found: ${indexPath}. Run ritsu_semantic_index_build first.`);
  }

  let index: SemanticIndexFile;
  try {
    index = loadSemanticIndex(indexPath);
  } catch (e: any) {
    return errorResult(e?.message ?? String(e));
  }

  const embedder = await getEmbedder();
  const q = await embedder.embed(query);

  // Optional KG load
  const kgPath = resolve(root, ".ritsu", "kg.json");
  let adj: Map<string, Set<string>> | null = null;
  if (existsSync(kgPath)) {
    try {
      const kg = loadKg(kgPath);
      adj = buildUndirectedAdj(kg.edges ?? []);
    } catch {
      adj = null;
    }
  }

  const focusRel = focusPaths.map((p) => toRelPath(root, p));

  const entryMap = new Map<string, SemanticIndexEntry>();
  for (const e of index.entries) entryMap.set(`${e.path}#${e.chunk_index}`, e);

  const matches: Match[] = [];

  for (const e of index.entries) {
    if (types.length > 0 && !types.includes(e.artifact_type)) continue;
    const artifactLayer = e.artifact_layer ?? "system";
    if (layers.length > 0 && !layers.includes(artifactLayer)) continue;

    const semanticScore = cosineSimilarity(q, e.embedding);

    let kgScore = 0;
    let kgBestPath: string[] | undefined;
    if (adj) {
      const snippetForExtract =
        typeof e.chunk_start === "number" && typeof e.chunk_end === "number"
          ? getSnippetByOffset(e.path, e.chunk_start, e.chunk_end)
          : "";
      const tokens = extractFileLikeTokens(snippetForExtract);
      const candRel = tokens.map((t) => toRelPath(root, t));
      const kgR = computeKgScore(adj, focusRel, candRel, maxDepth);
      kgScore = kgR.kg_score;
      kgBestPath = kgR.best_path;
    }

    const score = semanticScore * semanticWeight + kgScore * kgWeight;

    matches.push({
      score,
      semantic_score: semanticScore,
      kg_score: kgScore,
      path: e.path,
      artifact_type: e.artifact_type,
      artifact_layer: artifactLayer,
      chunk_index: e.chunk_index,
      heading: e.heading,
      snippet: "",
      kg_best_path: kgBestPath,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, topK).map((m) => {
    const entry = entryMap.get(`${m.path}#${m.chunk_index}`);
    const snippet =
      entry && typeof entry.chunk_start === "number" && typeof entry.chunk_end === "number"
        ? getSnippetByOffset(m.path, entry.chunk_start, entry.chunk_end)
        : getLegacySnippet(m.path, m.chunk_index, chunkSize, overlap);
    return { ...m, snippet };
  });

  return textResult(
    JSON.stringify({
      ok: true,
      query,
      top_k: topK,
      focus_paths: focusRel,
      index_path: indexPath,
      kg_path: existsSync(kgPath) ? kgPath : null,
      embedder_model: embedder.model_id,
      semantic_weight: semanticWeight,
      kg_weight: kgWeight,
      kg_depth: maxDepth,
      total_index_entries: index.entries.length,
      matches: top,
    }),
  );
}
