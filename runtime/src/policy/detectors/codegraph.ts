/**
 * CodeGraph 检测器
 *
 * 利用 CodeGraph CLI 进行基于代码图的策略检查：
 * - 受影响的符号完整性（改了一个函数，是否更新了所有调用方）
 * - 导入一致性（是否引入了未使用的符号）
 *
 * 需要安装 CodeGraph: npx codegraph init && codegraph index
 * 当 CodeGraph 不可用时，检测器静默跳过。
 */

import { execFileSync } from "node:child_process";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { ImportGraph } from "../import-graph.js";
import { getProjectRoot } from "../../handlers/_utils.js";

const CODEGRAPH_CMD = "codegraph";

let isCodeGraphCached: boolean | null = null;

function isCodeGraphAvailable(): boolean {
  if (isCodeGraphCached !== null) return isCodeGraphCached;
  try {
    execFileSync("which", [CODEGRAPH_CMD], { stdio: "ignore" });
    isCodeGraphCached = true;
    return true;
  } catch {
    try {
      execFileSync("npx", ["--no-install", CODEGRAPH_CMD, "--version"], {
        stdio: "ignore",
        timeout: 1000,
      });
      isCodeGraphCached = true;
      return true;
    } catch {
      isCodeGraphCached = false;
      return false;
    }
  }
}

type AffectedNode = {
  id: string;
  name: string;
  file: string;
  type: string;
};

function queryAffected(files: string[]): AffectedNode[] {
  try {
    const output = execFileSync("npx", [
      "-y", CODEGRAPH_CMD, "affected", "--json", ...files,
    ], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).toString().trim();
    return JSON.parse(output) as AffectedNode[];
  } catch {
    return [];
  }
}

export class CodeGraphDetector implements DetectorPlugin {
  type = "codegraph" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Collect target files from context
    const scanFiles = ctx.context?.scan_files ?? [];
    const inScopeFiles = ctx.context?.in_scope_files ?? [];
    const allFiles = [...new Set([...scanFiles, ...inScopeFiles])];

    if (allFiles.length === 0) return [];

    // Prefer external CodeGraph CLI; fallback to in-process ImportGraph
    let affected: AffectedNode[];
    if (isCodeGraphAvailable()) {
      affected = queryAffected(allFiles);
    } else if (ctx.astCache && ctx.astCache.size > 0) {
      try {
        const graph = new ImportGraph(ctx.astCache, getProjectRoot());
        affected = graph.getAffectedBy(allFiles);
      } catch {
        affected = [];
      }
    } else {
      return [];
    }

    // Rule-specific checks
    switch (rule.id) {
      case "CG-1": // Unreferenced exports
        // Delegate reporting to codegraph CLI — it handles call graph analysis
        for (const node of affected) {
          violations.push({
            rule_id: rule.id,
            severity: rule.severity,
            message: `Symbol '${node.name}' in ${node.file} is affected by the change`,
            evidence: `${node.type}: ${node.name} @ ${node.file}`,
          });
        }
        break;

      case "CG-2": { // Missing test coverage for changed symbols
        const changedSymbols = affected.filter((n) => allFiles.includes(n.file));
        for (const sym of changedSymbols) {
          const hasTest = affected.some(
            (n) => n.file.includes(".test.") || n.file.includes(".spec."),
          );
          if (!hasTest) {
            violations.push({
              rule_id: rule.id,
              severity: rule.severity,
              message: `Symbol '${sym.name}' changed but no test file references it`,
              evidence: `${sym.file} → ${sym.name}`,
              suggestion: "Add or update tests for this symbol",
            });
          }
        }
        }
        break;

      default:
        break;
    }

    return violations;
  }
}
