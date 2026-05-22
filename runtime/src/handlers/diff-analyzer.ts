import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inspectDiff, type InspectDiffMode } from "../orchestration/diff-inspect.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { runGit } from "./_git-utils.js";

interface ChangedFile {
  path: string;
  status: string;
  extension: string;
}

const DOMAIN_SUFFIX_MAP: Record<string, string[]> = {
  frontend: [".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".less", ".html", ".svg"],
  backend: [".go", ".java", ".py", ".rs", ".rb", ".php", ".sql"],
  infra: [".tf", ".dockerfile", ".sh", ".yml", ".yaml"],
  data: [".ipynb", ".parquet", ".dbt", ".sql"],
};

function inferDomain(files: ChangedFile[]): string {
  const hits: Record<string, number> = { frontend: 0, backend: 0, infra: 0, data: 0 };
  for (const f of files) {
    for (const [domain, exts] of Object.entries(DOMAIN_SUFFIX_MAP)) {
      if (exts.some((ext) => f.path.endsWith(ext))) hits[domain]++;
    }
  }
  const sorted = Object.entries(hits).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return "unknown";
  const top = sorted[0][0];
  const second = sorted[1][0];
  if (
    top !== second &&
    hits[top] > 0 &&
    hits[second] > 0 &&
    ((top === "frontend" && second === "backend") ||
      (top === "backend" && second === "frontend"))
  ) {
    return "fullstack";
  }
  return top;
}

function parseMode(value: unknown): InspectDiffMode {
  const m = String(value ?? "full").toLowerCase();
  if (m === "stat" || m === "chunks" || m === "full") return m;
  return "full";
}

/** Get changed files from git working tree */
export async function ritsu_get_changed_files(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const staged = params.staged !== false;
  const unstaged = params.unstaged !== false;

  const allFiles: ChangedFile[] = [];
  const seen = new Set<string>();

  if (unstaged) {
    const r = await runGit(["diff", "--name-status"], root);
    if (!r.ok) return errorResult(`git diff failed: ${r.output}`);
    for (const line of r.output.split("\n")) {
      if (!line.trim()) continue;
      const [status, ...pathParts] = line.split(/\s+/);
      const path = pathParts.join(" ");
      if (path && !seen.has(path)) {
        seen.add(path);
        allFiles.push({
          path,
          status: status ?? "M",
          extension: path.includes(".") ? "." + path.split(".").pop()! : "",
        });
      }
    }
  }

  if (staged) {
    const r = await runGit(["diff", "--name-status", "--cached"], root);
    if (!r.ok) return errorResult(`git diff --cached failed: ${r.output}`);
    for (const line of r.output.split("\n")) {
      if (!line.trim()) continue;
      const [status, ...pathParts] = line.split(/\s+/);
      const path = pathParts.join(" ");
      if (path && !seen.has(path)) {
        seen.add(path);
        allFiles.push({
          path,
          status: status ?? "M",
          extension: path.includes(".") ? "." + path.split(".").pop()! : "",
        });
      }
    }
  }

  const domain = inferDomain(allFiles);

  return textResult(
    JSON.stringify({
      files: allFiles,
      total: allFiles.length,
      domain_hint: domain,
    }),
  );
}

/** Inspect git diff with mode selection */
export async function ritsu_inspect_diff(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const result = await inspectDiff({
    projectRoot: root,
    mode: parseMode(params.mode),
    cached: params.cached === true,
    maxOutputLines: Number(params.max_output_lines ?? 500),
    topN: Number(params.top_n ?? 20),
  });
  if (!result.ok) return errorResult(result.error);
  return textResult(JSON.stringify(result.data, null, 2));
}

/** @deprecated Use ritsu_inspect_diff mode=full */
export async function ritsu_get_diff(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  return ritsu_inspect_diff({ ...params, mode: "full" });
}

/** @deprecated Use ritsu_inspect_diff mode=chunks */
export async function ritsu_diff_chunks(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  return ritsu_inspect_diff({ ...params, mode: "chunks" });
}

/** Unified git changes entry: routes to status or diff based on mode */
export async function ritsu_inspect_git_changes(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const mode = String(params.mode ?? "full").toLowerCase();
  if (mode === "status") {
    return ritsu_get_changed_files(params);
  }
  return ritsu_inspect_diff(params);
}
