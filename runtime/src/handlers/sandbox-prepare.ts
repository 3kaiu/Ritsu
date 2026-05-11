import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { runGit } from "./_git-utils.js";

export async function ritsu_sandbox_prepare(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cid = String(params.correlation_id ?? "").trim();
  if (!cid) return errorResult("correlation_id is required");

  const baseRef = String(params.base_ref ?? "HEAD").trim() || "HEAD";

  const tempRoot = resolve(root, ".ritsu", "temp");
  mkdirSync(tempRoot, { recursive: true });

  const sandboxPath = resolve(tempRoot, cid);

  // clean if exists
  if (existsSync(sandboxPath)) {
    try {
      await runGit(["worktree", "remove", "--force", sandboxPath], root);
    } catch {
      // ignore
    }
    rmSync(sandboxPath, { recursive: true, force: true });
  }

  const addR = await runGit(["worktree", "add", "--detach", sandboxPath, baseRef], root);
  if (!addR.ok) return errorResult(`git worktree add failed: ${addR.output}`);

  return textResult(
    JSON.stringify({
      ok: true,
      sandbox_path: sandboxPath,
      base_ref: baseRef,
    }),
  );
}
