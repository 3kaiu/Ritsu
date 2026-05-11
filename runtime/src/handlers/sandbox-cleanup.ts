import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { runGit } from "./_git-utils.js";

export async function ritsu_sandbox_cleanup(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cid = String(params.correlation_id ?? "").trim();
  if (!cid) return errorResult("correlation_id is required");

  const sandboxPath = resolve(root, ".ritsu", "temp", cid);
  if (!existsSync(sandboxPath)) {
    return textResult(JSON.stringify({ ok: true, removed: false, sandbox_path: sandboxPath }));
  }

  const rmR = await runGit(["worktree", "remove", "--force", sandboxPath], root);
  if (!rmR.ok) {
    // best-effort fallback
    rmSync(sandboxPath, { recursive: true, force: true });
    return textResult(
      JSON.stringify({
        ok: true,
        removed: true,
        sandbox_path: sandboxPath,
        warning: rmR.output,
      }),
    );
  }

  rmSync(sandboxPath, { recursive: true, force: true });
  return textResult(JSON.stringify({ ok: true, removed: true, sandbox_path: sandboxPath }));
}
