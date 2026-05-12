import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

  const fallbackRoot = resolve(tmpdir(), "ritsu-sandboxes");
  mkdirSync(fallbackRoot, { recursive: true });
  const fallbackClonePath = resolve(fallbackRoot, cid);

  let tempRoot = resolve(root, ".ritsu", "temp");
  let sandboxPath = resolve(tempRoot, cid);
  let warning: string | null = null;
  try {
    mkdirSync(tempRoot, { recursive: true });
  } catch (e: any) {
    tempRoot = fallbackRoot;
    sandboxPath = resolve(tempRoot, cid);
    warning = `repo temp dir unavailable: ${e?.message ?? String(e)}`;
  }

  // clean if exists
  if (existsSync(sandboxPath)) {
    try {
      await runGit(["worktree", "remove", "--force", sandboxPath], root);
    } catch {
      // ignore
    }
    rmSync(sandboxPath, { recursive: true, force: true });
  }
  if (existsSync(fallbackClonePath)) {
    rmSync(fallbackClonePath, { recursive: true, force: true });
  }

  const addR = await runGit(["worktree", "add", "--detach", sandboxPath, baseRef], root);
  if (addR.ok) {
    return textResult(
      JSON.stringify({
        ok: true,
        sandbox_path: sandboxPath,
        base_ref: baseRef,
        mode: "worktree",
        warning,
      }),
    );
  }

  // Fallback: some environments cannot mutate source .git/worktrees or create
  // nested sandboxes inside the main repo. In that case, use an isolated clone
  // in the system temp directory.
  if (existsSync(fallbackClonePath)) {
    rmSync(fallbackClonePath, { recursive: true, force: true });
  }
  const cloneR = await runGit(
    ["clone", "--no-local", root, fallbackClonePath],
    root,
  );
  if (!cloneR.ok) {
    return errorResult(
      `sandbox prepare failed: git worktree add failed (${addR.output}); clone fallback failed (${cloneR.output})`,
    );
  }

  const checkoutR = await runGit(
    ["-C", fallbackClonePath, "checkout", "--detach", baseRef],
    root,
  );
  if (!checkoutR.ok) {
    rmSync(fallbackClonePath, { recursive: true, force: true });
    return errorResult(
      `sandbox clone prepared but checkout failed: ${checkoutR.output}`,
    );
  }

  return textResult(
    JSON.stringify({
      ok: true,
      sandbox_path: fallbackClonePath,
      base_ref: baseRef,
      mode: "clone-fallback",
      warning: [warning, addR.output].filter(Boolean).join("; ") || null,
    }),
  );
}
