import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { getEmbedder } from "./_semantic-embed.js";
import { getSharedDir } from "../shared.js";
import { load as loadYaml } from "js-yaml";

type ArtifactType =
  | "intake-ticket"
  | "delivery-report"
  | "assurance-report"
  | "handoff"
  | "diagnosis"
  | "review-stamp"
  | "optimize-report";

type IndexEntry = {
  id: string;
  artifact_type: ArtifactType;
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
  generated_at: string;
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
  if (fileName.startsWith("intake-ticket-")) return "intake-ticket";
  if (fileName.startsWith("delivery-report-")) return "delivery-report";
  if (fileName.startsWith("assurance-report-")) return "assurance-report";
  if (fileName.startsWith("handoff-")) return "handoff";
  if (fileName.startsWith("diagnosis-")) return "diagnosis";
  if (fileName.startsWith("review-stamp-")) return "review-stamp";
  if (fileName.startsWith("optimize-report-")) return "optimize-report";
  return null;
}

function normalizeHeadingTitle(heading: string): string {
  return heading
    .replace(/^#{1,6}\s+/, "")
    .trim()
    .toLowerCase();
}

function getImportantSectionTitlesByType(): Partial<
  Record<ArtifactType, Set<string>>
> {
  // Best-effort: read artifact-schema.yaml to discover required section titles.
  // If unavailable or malformed, we fall back to heading-based chunking only.
  try {
    const schemaPath = resolve(getSharedDir(), "artifact-schema.yaml");
    if (!existsSync(schemaPath)) return {};
    const raw = readFileSync(schemaPath, "utf-8");
    const doc = loadYaml(raw) as any;
    const schemas = doc?.schemas;

    const pickTitles = (schemaKey: string): Set<string> => {
      const required = schemas?.[schemaKey]?.required_sections;
      if (!Array.isArray(required)) return new Set();
      const titles = required
        .map((s: any) => (typeof s?.title === "string" ? s.title : ""))
        .filter(Boolean)
        .map((t: string) => t.trim().toLowerCase());
      return new Set(titles);
    };

    return {
      "intake-ticket": pickTitles("intake_ticket"),
      "delivery-report": pickTitles("delivery_report"),
      "assurance-report": pickTitles("assurance_report"),
      handoff: pickTitles("handoff"),
      diagnosis: pickTitles("diagnosis"),
      // schema uses review_stamp key; runtime artifact type is review-stamp
      "review-stamp": pickTitles("review_stamp"),
    };
  } catch {
    return {};
  }
}

type Section = {
  heading: string;
  start: number;
  end: number;
};

function splitMarkdownSections(text: string): Section[] {
  const clean = text;
  if (!clean.trim()) return [];

  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  const hits: Array<{ start: number; heading: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(clean)) !== null) {
    hits.push({ start: m.index, heading: `${m[1]} ${m[2].trim()}` });
  }

  // No headings: treat whole file as a single section.
  if (hits.length === 0) {
    return [{ heading: "(document)", start: 0, end: clean.length }];
  }

  const sections: Section[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].start;
    const end = i + 1 < hits.length ? hits[i + 1].start : clean.length;
    sections.push({ heading: hits[i].heading, start, end });
  }
  return sections;
}

function chunkRange(
  text: string,
  start: number,
  end: number,
  chunkSize: number,
  overlap: number,
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const section = text.slice(start, end).trim();
  if (!section) return out;

  // Map trimmed section back to absolute offsets.
  const leadingWs = text.slice(start, end).indexOf(section[0]);
  const absStart = start + Math.max(0, leadingWs);
  let i = 0;
  while (i < section.length) {
    const relEnd = Math.min(section.length, i + chunkSize);
    const absChunkStart = absStart + i;
    const absChunkEnd = absStart + relEnd;
    out.push({
      start: absChunkStart,
      end: absChunkEnd,
      text: section.slice(i, relEnd),
    });
    if (relEnd >= section.length) break;
    i = Math.max(0, relEnd - overlap);
  }
  return out;
}

function loadExistingIndex(path: string): SemanticIndexFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as SemanticIndexFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries))
      return null;
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
  const importantTitlesByType = getImportantSectionTitlesByType();

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

    const sections = splitMarkdownSections(content);
    let chunkIndex = 0;
    for (const s of sections) {
      const titleNorm = normalizeHeadingTitle(s.heading);
      const importantSet = importantTitlesByType[t];
      const isImportant = importantSet ? importantSet.has(titleNorm) : false;

      if (isImportant) {
        const whole = content.slice(s.start, s.end).trim();
        if (whole) {
          const wholeText = whole.length > 4000 ? whole.slice(0, 4000) : whole;
          const embWhole = await embedder.embed(wholeText);
          const leadingWs = content.slice(s.start, s.end).indexOf(whole[0]);
          const absStart = s.start + Math.max(0, leadingWs);
          const absEnd = absStart + wholeText.length;
          newEntries.push({
            id: `se-${sha256(`${abs}:${contentHash}:${chunkIndex}`).slice(0, 16)}`,
            artifact_type: t,
            path: abs,
            chunk_index: chunkIndex,
            heading: s.heading,
            chunk_start: absStart,
            chunk_end: Math.min(absEnd, content.length),
            content_hash: contentHash,
            embedding: embWhole,
            created_at: nowIso(),
          });
          chunkIndex++;
        }
      }

      const chunks = chunkRange(content, s.start, s.end, chunkSize, overlap);
      for (const c of chunks) {
        const emb = await embedder.embed(c.text);
        newEntries.push({
          id: `se-${sha256(`${abs}:${contentHash}:${chunkIndex}`).slice(0, 16)}`,
          artifact_type: t,
          path: abs,
          chunk_index: chunkIndex,
          heading: s.heading,
          chunk_start: c.start,
          chunk_end: c.end,
          content_hash: contentHash,
          embedding: emb,
          created_at: nowIso(),
        });
        chunkIndex++;
      }
    }
  }

  const mergedEntries = [...reused, ...newEntries];
  const dim = mergedEntries.length > 0 ? mergedEntries[0].embedding.length : 0;
  const generatedAt = nowIso();

  const out: SemanticIndexFile = {
    version: 1,
    generated_at: generatedAt,
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
      generated_at: generatedAt,
      files_scanned: files.length,
      entries_total: mergedEntries.length,
      entries_added: newEntries.length,
      entries_reused: reused.length,
      dim,
    }),
  );
}
