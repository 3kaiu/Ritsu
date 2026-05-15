import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
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
