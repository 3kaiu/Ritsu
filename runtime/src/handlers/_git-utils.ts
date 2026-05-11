import { spawn } from "node:child_process";

export async function runGit(
  args: string[],
  cwd: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        ok: code === 0,
        output: (code === 0 ? stdout : stderr || stdout).trim(),
      });
    });

    child.on("error", (err) => resolvePromise({ ok: false, output: err.message }));
  });
}
