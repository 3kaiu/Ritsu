import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, lstatSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { runGit } from "./_git-utils.js";

export async function ritsu_sandbox_cleanup(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cid = String(params.correlation_id ?? "").trim();
  if (!cid) return errorResult("correlation_id is required");

  const internalPath = resolve(root, ".ritsu", "temp", cid);
  const externalPath = resolve(tmpdir(), "ritsu-sandboxes", cid);
  const sandboxPath = existsSync(internalPath) ? internalPath : externalPath;
  if (!existsSync(sandboxPath)) {
    return textResult(JSON.stringify({ ok: true, removed: false, sandbox_path: sandboxPath }));
  }

  let symlinkTarget: string | null = null;
  try {
    const stat = lstatSync(sandboxPath);
    if (stat.isSymbolicLink()) {
      const raw = readlinkSync(sandboxPath);
      symlinkTarget = raw.startsWith("/") ? raw : realpathSync(sandboxPath);
    }
  } catch {
    symlinkTarget = null;
  }

  const rmR = await runGit(["worktree", "remove", "--force", sandboxPath], root);
  if (!rmR.ok) {
    // best-effort fallback
    rmSync(sandboxPath, { recursive: true, force: true });
    if (symlinkTarget && existsSync(symlinkTarget)) {
      rmSync(symlinkTarget, { recursive: true, force: true });
    }
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
  if (symlinkTarget && existsSync(symlinkTarget)) {
    rmSync(symlinkTarget, { recursive: true, force: true });
  }
  return textResult(JSON.stringify({ ok: true, removed: true, sandbox_path: sandboxPath }));
}
