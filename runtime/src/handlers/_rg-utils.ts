import { spawn } from "node:child_process";

export async function runRg(
  pattern: string,
  cwd: string,
  globs: string[] = [],
  maxBytes = 10 * 1024 * 1024,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const args = ["--no-heading", "--line-number", "--color", "never", pattern, "."];
    for (const g of globs) args.unshift("--glob", g);

    const child = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0 || code === 1,
        output: (code === 0 || code === 1 ? stdout : stderr || stdout).trim(),
      });
    });

    child.on("error", (err) => resolvePromise({ ok: false, output: err.message }));
  });
}

export function parseRgFilePaths(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^([^:]+):\d+:/);
    if (m) files.add(m[1]);
  }
  return Array.from(files);
}
