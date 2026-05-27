import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { evaluatePolicies } from "../policy/index.js";
import type { PolicyViolation } from "../policy/types.js";
import { runGit } from "../handlers/_git-utils.js";
import { captureQualityGateWorktreeState } from "../quality-gates.js";

export type PolicyPreflightResult = {
  passed: boolean;
  violations: PolicyViolation[];
  scan_files: string[];
  diff_bytes: number;
  cached?: boolean;
};

type PolicyCacheEntry = {
  worktreeHash: string;
  skill: string;
  result: PolicyPreflightResult;
  at: number;
};

const CACHE_TTL_MS = 30_000;
let policyCache: PolicyCacheEntry | null = null;

export function parseChangedPaths(statOutput: string): string[] {
  const paths: string[] = [];
  for (const line of statOutput.split("\n")) {
    const match = line.match(/^\s*\d+\s+\d+\s+(.+)$/);
    if (match) paths.push(match[1].trim());
  }
  return paths;
}

async function computeWorktreeHash(projectRoot: string): Promise<string> {
  const wt = await captureQualityGateWorktreeState(projectRoot);
  if (wt.ok && wt.worktree?.fingerprint) {
    return wt.worktree.fingerprint;
  }
  const statR = await runGit(["diff", "--stat"], projectRoot);
  const body = statR.ok ? statR.output : "";
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function clearPolicyPreflightCache(): void {
  policyCache = null;
}

export async function runPolicyPreflight(
  projectRoot: string,
  skill: string,
  options?: { skipCache?: boolean },
): Promise<PolicyPreflightResult> {
  const worktreeHash = await computeWorktreeHash(projectRoot);
  const now = Date.now();

  if (
    !options?.skipCache &&
    policyCache &&
    policyCache.skill === skill &&
    policyCache.worktreeHash === worktreeHash &&
    now - policyCache.at < CACHE_TTL_MS
  ) {
    return { ...policyCache.result, cached: true };
  }

  const statR = await runGit(["diff", "--stat"], projectRoot);
  const cachedStatR = await runGit(["diff", "--stat", "--cached"], projectRoot);
  const paths = new Set<string>();
  if (statR.ok) parseChangedPaths(statR.output).forEach((p) => paths.add(p));
  if (cachedStatR.ok) parseChangedPaths(cachedStatR.output).forEach((p) => paths.add(p));

  const scan_files = [...paths];
  const patchR = await runGit(["diff", "--unified=3"], projectRoot);
  const cachedPatchR = await runGit(["diff", "--unified=3", "--cached"], projectRoot);
  const diffParts: string[] = [];
  if (patchR.ok && patchR.output) diffParts.push(patchR.output);
  if (cachedPatchR.ok && cachedPatchR.output) diffParts.push(cachedPatchR.output);
  const content = diffParts.join("\n");

  if (scan_files.length === 0 && !content.trim()) {
    const empty: PolicyPreflightResult = {
      passed: true,
      violations: [],
      scan_files: [],
      diff_bytes: 0,
    };
    policyCache = { worktreeHash, skill, result: empty, at: now };
    return empty;
  }

  if (!existsSync(resolve(projectRoot, "rules/ast-grep"))) {
    // ast-grep detector no-ops
  }

  const { passed, violations } = evaluatePolicies({
    action: "commit_diff",
    content: content || undefined,
    context: { skill, scan_files },
  });

  const result: PolicyPreflightResult = {
    passed,
    violations,
    scan_files,
    diff_bytes: content.length,
  };
  policyCache = { worktreeHash, skill, result, at: now };
  return result;
}
