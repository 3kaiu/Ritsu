import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { getEmbedder } from "./_semantic-embed.js";

type ArtifactType = "handoff" | "diagnosis" | "review-stamp" | "optimize-report";

type IndexEntry = {
  id: string;
  artifact_type: ArtifactType;
  path: string;
  chunk_index: number;
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

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function detectArtifactType(fileName: string): ArtifactType | null {
  if (fileName.startsWith("handoff-")) return "handoff";
  if (fileName.startsWith("diagnosis-")) return "diagnosis";
  if (fileName.startsWith("review-stamp-")) return "review-stamp";
  if (fileName.startsWith("optimize-report-")) return "optimize-report";
  return null;
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + chunkSize);
    out.push(clean.slice(i, end));
    if (end >= clean.length) break;
    i = Math.max(0, end - overlap);
  }
  return out;
}

function loadExistingIndex(path: string): SemanticIndexFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as SemanticIndexFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function ritsu_semantic_index_build(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  if (!existsSync(ritsuDir)) {
    return errorResult(`.ritsu directory not found: ${ritsuDir}`);
  }

  const chunkSize = Math.min(Number(params.chunk_size ?? 1200), 4000);
  const overlap = Math.min(Number(params.chunk_overlap ?? 200), 1000);
  const maxFiles = Math.min(Number(params.max_files ?? 200), 2000);

  const indexPath = resolve(ritsuDir, "semantic-index.json");
  const existing = loadExistingIndex(indexPath);

  const embedder = await getEmbedder();

  const files = readdirSync(ritsuDir)
    .filter((f) => f.endsWith(".md"))
    .slice(0, maxFiles);

  const newEntries: IndexEntry[] = [];
  const reused: IndexEntry[] = [];

  const existingByKey = new Map<string, IndexEntry[]>();
  if (existing) {
    for (const e of existing.entries) {
      const key = `${e.path}#${e.content_hash}`;
      const arr = existingByKey.get(key) ?? [];
      arr.push(e);
      existingByKey.set(key, arr);
    }
  }

  for (const f of files) {
    const t = detectArtifactType(f);
    if (!t) continue;

    const abs = resolve(ritsuDir, f);
    let content = "";
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }

    const contentHash = sha256(content);
    const key = `${abs}#${contentHash}`;

    const cached = existingByKey.get(key);
    if (cached && cached.length > 0) {
      reused.push(...cached);
      continue;
    }

    const chunks = chunkText(content, chunkSize, overlap);
    for (let i = 0; i < chunks.length; i++) {
      const emb = await embedder.embed(chunks[i]);
      newEntries.push({
        id: `se-${sha256(`${abs}:${contentHash}:${i}`).slice(0, 16)}`,
        artifact_type: t,
        path: abs,
        chunk_index: i,
        content_hash: contentHash,
        embedding: emb,
        created_at: nowIso(),
      });
    }
  }

  const mergedEntries = [...reused, ...newEntries];
  const dim = mergedEntries.length > 0 ? mergedEntries[0].embedding.length : 0;

  const out: SemanticIndexFile = {
    version: 1,
    embedder_model: embedder.model_id,
    dim,
    entries: mergedEntries,
  };

  mkdirSync(ritsuDir, { recursive: true });
  writeFileSync(indexPath, JSON.stringify(out), "utf-8");

  return textResult(
    JSON.stringify({
      ok: true,
      index_path: indexPath,
      embedder_model: embedder.model_id,
      files_scanned: files.length,
      entries_total: mergedEntries.length,
      entries_added: newEntries.length,
      entries_reused: reused.length,
      dim,
    }),
  );
}
