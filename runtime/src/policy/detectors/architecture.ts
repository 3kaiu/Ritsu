/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * 架构漂移检测器
 *
 * 作为 Ritsu 策略引擎的第 9 个检测器。
 * 在 preflight 时自动分析 diff 中的跨模块依赖变化，
 * 与已学习的架构指纹对比 → 发现漂移 → 生成 policy violation。
 */

import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

export class ArchitectureDetector implements DetectorPlugin {
  type = "architecture" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const root = getProjectRoot();

    // Only runs on write_artifact or commit_diff
    if (ctx.action !== "write_artifact" && ctx.action !== "commit_diff") return [];

    // Get changed files from context
    const scanFiles = ctx.context?.scan_files ?? [];
    const inScopeFiles = ctx.context?.in_scope_files ?? [];
    const allFiles = [...new Set([...scanFiles, ...inScopeFiles])].filter((f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js"));

    if (allFiles.length === 0) return [];

    try {
      const { checkArchitectureDrift } = require("../../orchestration/architecture-analyzer.js") as typeof import("../../orchestration/architecture-analyzer.js");
      const driftViolations = checkArchitectureDrift(allFiles, root);

      for (const dv of driftViolations) {
        violations.push({
          rule_id: rule.id,
          severity: dv.severity === "hard_stop" ? "hard_stop" : "warn",
          message: dv.message,
          evidence: `${dv.fromModule} → ${dv.toModule}`,
          suggestion: dv.type === "circular_dependency"
            ? "Extract shared logic into a common module"
            : dv.type === "unexpected_dependency"
              ? "Consider if this dependency is necessary or if there's a cleaner abstraction boundary"
              : "Review module boundaries",
        });
      }
    } catch {
      // Graceful fallback — architecture analysis is non-critical
    }

    return violations;
  }
}
