import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, warnResult } from "./_utils.js";
import {
  parseCommand,
  runCmdWithCwd,
  validateCommandSafety,
} from "./_cmd-utils.js";
import { runGit } from "./_git-utils.js";

function parseEnvKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Z0-9_]+)\s*=/);
    if (m) keys.add(m[1]);
  }
  return Array.from(keys);
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

export async function ritsu_env_probe(
  _params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();

  const ritsuDir = resolve(root, ".ritsu");
  const tempDir = resolve(ritsuDir, "temp");

  let ritsuDirWritable = false;
  let tempDirWritable = false;
  try {
    mkdirSync(ritsuDir, { recursive: true });
    accessSync(ritsuDir, constants.W_OK);
    ritsuDirWritable = true;
  } catch {
    ritsuDirWritable = false;
  }

  try {
    mkdirSync(tempDir, { recursive: true });
    accessSync(tempDir, constants.W_OK);
    tempDirWritable = true;
  } catch {
    tempDirWritable = false;
  }

  const safeRun = async (
    command: string,
  ): Promise<{ ok: boolean; output: string }> => {
    const safety = validateCommandSafety(command);
    if (!safety.ok)
      return { ok: false, output: safety.error ?? "command blocked" };
    const parsed = parseCommand(command);
    if (!parsed) return { ok: false, output: "empty command after parsing" };
    return runCmdWithCwd(parsed, root, 50, 10_000, 2);
  };

  const gitVersion = await safeRun("git --version");
  const nodeVersion = { ok: true, output: process.version };
  const gitInsideWorkTree = await runGit(
    ["rev-parse", "--is-inside-work-tree"],
    root,
  );
  const gitWorktreeList = await runGit(["worktree", "list"], root);

  const envExamplePath = resolve(root, ".env.example");
  const envPath = resolve(root, ".env");

  const expectedKeys = existsSync(envExamplePath)
    ? parseEnvKeys(readFileSync(envExamplePath, "utf-8"))
    : [];

  const actual = parseEnvFile(envPath);

  const missing = expectedKeys.filter((k) => !(k in actual) && !process.env[k]);

  const pkgPath = resolve(root, "package.json");
  const pkg = existsSync(pkgPath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(pkgPath, "utf-8"));
        } catch {
          return null;
        }
      })()
    : null;

  const data: Record<string, unknown> = {
    project_root: root,
    platform: process.platform,
    arch: process.arch,
    has_env_example: existsSync(envExamplePath),
    has_env: existsSync(envPath),
    expected_env_keys: expectedKeys,
    missing_env_keys: missing,
    package_json: pkg ? { name: pkg.name, scripts: pkg.scripts ?? {} } : null,
    sandbox: {
      ritsu_dir: ritsuDir,
      temp_dir: tempDir,
      ritsu_dir_writable: ritsuDirWritable,
      temp_dir_writable: tempDirWritable,
    },
    tools: {
      git: gitVersion,
      node: nodeVersion,
    },
    git: {
      is_inside_work_tree: gitInsideWorkTree.ok
        ? gitInsideWorkTree.output
        : `error: ${gitInsideWorkTree.output}`,
      worktree_list_ok: gitWorktreeList.ok,
      worktree_list: gitWorktreeList.ok
        ? gitWorktreeList.output
        : gitWorktreeList.output,
    },
  };

  const warnings: string[] = [];
  if (missing.length > 0)
    warnings.push(`missing env keys: ${missing.join(", ")}`);
  if (!ritsuDirWritable) warnings.push(`.ritsu not writable: ${ritsuDir}`);
  if (!tempDirWritable) warnings.push(`.ritsu/temp not writable: ${tempDir}`);
  if (!gitVersion.ok) warnings.push(`git not available: ${gitVersion.output}`);
  if (!gitInsideWorkTree.ok)
    warnings.push(`git repo not ready: ${gitInsideWorkTree.output}`);

  if (warnings.length > 0) {
    return warnResult(data, warnings.join("; "));
  }

  return textResult(JSON.stringify(data));
}
