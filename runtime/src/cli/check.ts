import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { detectProjectRoot } from "../project-root.js";
import { evaluatePolicies } from "../policy/index.js";
import { color } from "./shared.js";
import { getRitsudBinaryPath } from "../launcher.js";

function findLineForViolation(content: string, v: any): number {
  if (v.evidence) {
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line: string) => line.includes(v.evidence!));
    if (index !== -1) return index + 1;
    // Try matching first 40 characters
    const cleanEvidence = v.evidence.trim().slice(0, 40);
    const index2 = lines.findIndex((line: string) => line.includes(cleanEvidence));
    if (index2 !== -1) return index2 + 1;
  }
  
  if (v.rule_id === "AP-6") {
    const lines = content.split(/\r?\n/);
    const todoIndex = lines.findIndex((line: string) => /\bTODO\b|\bTBD\b|待定|暂不处理|后续完善/.test(line));
    if (todoIndex !== -1) return todoIndex + 1;
  }
  return 1;
}

export function runCheck(cmdArgs: string[]) {
  const root = detectProjectRoot();
  const isStaged = cmdArgs.includes("--staged");

  if (!isStaged) {
    console.error(color("❌ Unsupported check mode. Only 'ritsu check --staged' is supported.", "red"));
    process.exit(1);
  }

  // Get staged files from Git
  const gitDiff = spawnSync("git", ["diff", "--name-only", "--cached"], { cwd: root, encoding: "utf-8" });
  if (gitDiff.status !== 0) {
    console.error(color("❌ Failed to list staged files from Git.", "red"));
    process.exit(1);
  }

  const stagedFiles = gitDiff.stdout
    .trim()
    .split(/\r?\n/)
    .map((f: string) => f.trim())
    .filter(Boolean);

  if (stagedFiles.length === 0) {
    console.log(color("✅ [ritsu check] No staged files to check.", "green"));
    process.exit(0);
  }

  // Check if native ritsud binary exists and delegate checking
  const ritsudPath = getRitsudBinaryPath(root);
  if (ritsudPath) {
    const codeFiles = stagedFiles.filter((f) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|json|yaml|yml|md)$/.test(f)
    );
    if (codeFiles.length === 0) {
      console.log(color("✅ [ritsu check] No staged code/config files to check.", "green"));
      process.exit(0);
    }
    console.log(color("⚡ [ritsu check] Delegating to native ritsud check...", "cyan"));
    const ritsudResult = spawnSync(ritsudPath, ["check", ...codeFiles], { cwd: root, stdio: "inherit" });
    process.exit(ritsudResult.status ?? 0);
  }

  let hasFatalViolations = false;

  for (const relPath of stagedFiles) {
    const absPath = resolve(root, relPath);
    if (!existsSync(absPath)) continue;

    // Only scan code / text / configuration / markdown files
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|md)$/.test(absPath)) {
      continue;
    }

    try {
      const content = readFileSync(absPath, "utf-8");
      const policyResult = evaluatePolicies({
        action: "commit_diff",
        target: relPath,
        content: content,
      });

      if (!policyResult.passed) {
        const failedViolations = policyResult.violations.filter(
          (v) => v.severity === "fatal" || v.severity === "hard_stop" || v.severity === "error"
        );

        if (failedViolations.length > 0) {
          hasFatalViolations = true;
          for (const v of failedViolations) {
            const line = findLineForViolation(content, v);
            console.error(
              color(
                `❌ [Linter Error] ${relPath}:${line}:1: error - [${v.rule_id}] ${v.message}. Suggestion: ${v.suggestion ?? "Please fix the violation."}`,
                "red"
              )
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ritsu check] Failed to check ${relPath}: ${err.message}`);
    }
  }

  if (hasFatalViolations) {
    console.error(color("❌ [ritsu check] Git commit rejected due to policy violations.", "red"));
    process.exit(1);
  } else {
    console.log(color("✅ [ritsu check] Staged files pass all guardrail checks.", "green"));
    process.exit(0);
  }
}
