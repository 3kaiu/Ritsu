import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch_summary: string;
}

interface NewIdentifier {
  name: string;
  file: string;
  line: number;
}

function runGit(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const maxBytes = 5 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, output: (code === 0 ? stdout : stderr || stdout).trim() });
    });
    child.on("error", (err) => resolve({ ok: false, output: err.message }));
  });
}

function parseStat(statOutput: string): DiffFile[] {
  const files: DiffFile[] = [];
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

function extractNewIdentifiers(patch: string): NewIdentifier[] {
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

export async function ritsu_get_diff(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cached = params.cached === true;
  const maxLines = Number(params.max_output_lines ?? 500);

  const diffArgs = cached
    ? ["diff", "--stat", "--cached"]
    : ["diff", "--stat"];
  const statR = await runGit(diffArgs, root);
  if (!statR.ok) return errorResult(`git diff --stat failed: ${statR.output}`);

  const files = parseStat(statR.output);

  const patchArgs = cached
    ? ["diff", "--unified=3", "--cached"]
    : ["diff", "--unified=3"];
  const patchR = await runGit(patchArgs, root);
  if (!patchR.ok) return errorResult(`git diff failed: ${patchR.output}`);

  const newIdentifiers = extractNewIdentifiers(patchR.output);

  const lines = patchR.output.split("\n");
  const truncated = lines.length > maxLines;
  const patch =
    (truncated ? lines.slice(0, maxLines).join("\n") + "\n⚠️ diff truncated" : patchR.output);

  return textResult(
    JSON.stringify({
      files,
      total_files: files.length,
      new_identifiers: newIdentifiers,
      diff: patch,
      truncated,
    }),
  );
}
