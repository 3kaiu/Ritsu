import { runGit } from "../handlers/_git-utils.js";

export interface DiffFileStat {
  path: string;
  additions: number;
  deletions: number;
  patch_summary: string;
}

export interface DiffChunk {
  file: string;
  hunkHeader: string;
  content: string;
  riskScore: number;
  riskFactors: string[];
}

export interface NewIdentifier {
  name: string;
  file: string;
  line: number;
}

export function parseStat(statOutput: string): DiffFileStat[] {
  const files: DiffFileStat[] = [];
  for (const line of statOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (match) {
      files.push({
        path: match[3].trim(),
        additions: parseInt(match[1], 10),
        deletions: parseInt(match[2], 10),
        patch_summary: `+${match[1]} -${match[2]}`,
      });
    }
  }
  return files;
}

export function analyzeRisk(file: string, lines: string[]): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  const content = lines.join("\n");
  if (file.includes("types") || file.includes("interfaces") || file.endsWith(".d.ts")) {
    score += 3;
    factors.push("shared_types_file");
  } else if (/(?:export\s+)?(?:interface|type)\s+\w+/.test(content)) {
    score += 2;
    factors.push("type_definition_change");
  }
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|JOIN|DROP|ALTER|CREATE)\b/i.test(content) && !file.includes(".md")) {
    score += 3;
    factors.push("sql_query");
  }
  if (
    /(?:auth|login|token|password|session|jwt|crypt|hash)/i.test(file) ||
    /(?:verify|authenticate|authorize|sign|encrypt)/i.test(content)
  ) {
    score += 4;
    factors.push("auth_security");
  }
  if (/(?:export\s+(?:function|const|class)\s+\w+|app\.(?:get|post|put|delete|use|patch))/.test(content)) {
    score += 2;
    factors.push("api_signature");
  }
  return { score, factors };
}

export function parseChunks(diffOutput: string): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let currentFile = "";
  let currentHunkHeader = "";
  let currentLines: string[] = [];

  const flushChunk = () => {
    if (currentFile && currentHunkHeader && currentLines.length > 0) {
      const addedLines = currentLines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      const { score, factors } = analyzeRisk(currentFile, addedLines);
      chunks.push({
        file: currentFile,
        hunkHeader: currentHunkHeader,
        content: currentLines.join("\n"),
        riskScore: score,
        riskFactors: factors,
      });
    }
  };

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("diff --git")) {
      flushChunk();
      currentFile = "";
      currentHunkHeader = "";
      currentLines = [];
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6);
    } else if (line.startsWith("@@ ")) {
      flushChunk();
      currentHunkHeader = line;
      currentLines = [];
    } else if (currentFile && currentHunkHeader) {
      currentLines.push(line);
    }
  }
  flushChunk();
  return chunks;
}

export function extractNewIdentifiers(patch: string): NewIdentifier[] {
  const identifiers: NewIdentifier[] = [];
  const seen = new Set<string>();
  let currentFile = "";
  for (const line of patch.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const fnMatch = line.match(
      /^\+\s*(?:export\s+)?(?:function|const|let|var|class|interface|type|enum|def|async\s+function)\s+(\w+)/,
    );
    if (fnMatch && currentFile) {
      const name = fnMatch[1];
      const key = `${currentFile}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        identifiers.push({ name, file: currentFile, line: 0 });
      }
    }
  }
  return identifiers;
}

export type InspectDiffMode = "stat" | "chunks" | "full";

export type InspectDiffOptions = {
  projectRoot: string;
  mode: InspectDiffMode;
  cached?: boolean;
  maxOutputLines?: number;
  topN?: number;
};

export type InspectDiffResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export async function inspectDiff(
  options: InspectDiffOptions,
): Promise<InspectDiffResult> {
  const { projectRoot, mode, cached = false } = options;
  const maxLines = options.maxOutputLines ?? 500;
  const topN = options.topN ?? 20;

  const statArgs = cached ? ["diff", "--stat", "--cached"] : ["diff", "--stat"];
  const patchArgs = cached
    ? ["diff", "--unified=3", "--cached"]
    : ["diff", "--unified=3"];

  if (mode === "stat") {
    const statR = await runGit(statArgs, projectRoot);
    if (!statR.ok) return { ok: false, error: `git diff --stat failed: ${statR.output}` };
    const files = parseStat(statR.output);
    return {
      ok: true,
      data: { files, total_files: files.length, mode: "stat" },
    };
  }

  const patchR = await runGit(patchArgs, projectRoot);
  if (!patchR.ok) return { ok: false, error: `git diff failed: ${patchR.output}` };

  if (mode === "chunks") {
    const chunks = parseChunks(patchR.output);
    chunks.sort((a, b) => b.riskScore - a.riskScore);
    return {
      ok: true,
      data: {
        mode: "chunks",
        total_chunks: chunks.length,
        chunks: chunks.slice(0, topN),
      },
    };
  }

  const statR = await runGit(statArgs, projectRoot);
  const files = statR.ok ? parseStat(statR.output) : [];
  const newIdentifiers = extractNewIdentifiers(patchR.output);
  const lines = patchR.output.split("\n");
  const truncated = lines.length > maxLines;
  const patch = truncated
    ? lines.slice(0, maxLines).join("\n") + "\n⚠️ diff truncated"
    : patchR.output;

  return {
    ok: true,
    data: {
      mode: "full",
      files,
      total_files: files.length,
      new_identifiers: newIdentifiers,
      diff: patch,
      truncated,
    },
  };
}
