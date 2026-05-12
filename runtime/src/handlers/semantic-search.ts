import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { cosineSimilarity, getEmbedder } from "./_semantic-embed.js";

type IndexEntry = {
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
  entries: IndexEntry[];
};

type Match = {
  score: number;
  path: string;
  artifact_type: string;
  artifact_layer: string;
  chunk_index: number;
  heading?: string;
  snippet: string;
};

function loadIndex(indexPath: string): SemanticIndexFile {
  const raw = readFileSync(indexPath, "utf-8");
  const parsed = JSON.parse(raw) as SemanticIndexFile;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("invalid semantic index file");
  }
  return parsed;
}

function getSnippet(
  path: string,
  chunkIndex: number,
  chunkSize: number,
  overlap: number,
): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const clean = content.trim();
  if (!clean) return "";

  const step = Math.max(1, chunkSize - overlap);
  const start = Math.max(0, chunkIndex * step);
  const end = Math.min(clean.length, start + chunkSize);
  return clean.slice(start, end).replace(/\s+/g, " ").trim();
}

function getSnippetByOffset(path: string, start: number, end: number): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const s = Math.max(0, Math.min(start, content.length));
  const e = Math.max(s, Math.min(end, content.length));
  return content.slice(s, e).replace(/\s+/g, " ").trim();
}

export async function ritsu_semantic_search(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const query = String(params.query ?? "").trim();
  const topK = Math.min(Number(params.top_k ?? 5), 50);
  const types = Array.isArray(params.types)
    ? (params.types as unknown[]).map((x) => String(x))
    : [];
  const layers = Array.isArray(params.layers)
    ? (params.layers as unknown[]).map((x) => String(x))
    : [];

  const chunkSize = Math.min(Number(params.chunk_size ?? 1200), 4000);
  const overlap = Math.min(Number(params.chunk_overlap ?? 200), 1000);

  if (!query) return errorResult("query is required");

  const indexPath = resolve(root, ".ritsu", "semantic-index.json");
  if (!existsSync(indexPath)) {
    return errorResult(
      `semantic index not found: ${indexPath}. Run ritsu_semantic_index_build first.`,
    );
  }

  let index: SemanticIndexFile;
  try {
    index = loadIndex(indexPath);
  } catch (e: any) {
    return errorResult(e?.message ?? String(e));
  }

  const embedder = await getEmbedder();
  const q = await embedder.embed(query);

  const entryMap = new Map<string, IndexEntry>();
  for (const e of index.entries) {
    entryMap.set(`${e.path}#${e.chunk_index}`, e);
  }

  const matches: Match[] = [];

  for (const e of index.entries) {
    if (types.length > 0 && !types.includes(e.artifact_type)) continue;
    const artifactLayer = e.artifact_layer ?? "system";
    if (layers.length > 0 && !layers.includes(artifactLayer)) continue;
    const score = cosineSimilarity(q, e.embedding);
    matches.push({
      score,
      path: e.path,
      artifact_type: e.artifact_type,
      artifact_layer: artifactLayer,
      chunk_index: e.chunk_index,
      heading: e.heading,
      snippet: "",
    });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, topK).map((m) => {
    const entry = entryMap.get(`${m.path}#${m.chunk_index}`);
    const snippet =
      entry &&
      typeof entry.chunk_start === "number" &&
      typeof entry.chunk_end === "number"
        ? getSnippetByOffset(m.path, entry.chunk_start, entry.chunk_end)
        : getSnippet(m.path, m.chunk_index, chunkSize, overlap);
    return { ...m, snippet };
  });

  return textResult(
    JSON.stringify({
      ok: true,
      query,
      top_k: topK,
      index_path: indexPath,
      embedder_model: embedder.model_id,
      total_index_entries: index.entries.length,
      matches: top,
    }),
  );
}
