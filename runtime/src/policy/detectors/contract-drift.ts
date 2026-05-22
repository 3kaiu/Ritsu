/**
 * Contract Drift 检测器 (R-4)
 *
 * 检查 git diff 中是否存在破坏性契约变更:
 * - 移除 export 声明 (exported function/const/class removed)
 * - 修改 export 签名 (参数变更)
 * - 标记为 @deprecated 但被删除
 *
 * 在 commit_diff 时扫描，检测改动的 exports 是否可能破坏上游调用方。
 */

import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class ContractDriftDetector implements DetectorPlugin {
  type = "contract_drift" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const content = ctx.content;
    if (!content) return violations;

    // Scan diff hunks for removed exports
    const removedExports = this.findRemovedExports(content);
    const modifiedSignatures = this.findModifiedSignatures(content);

    for (const exp of removedExports) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Exported symbol '${exp}' was removed — potential breaking contract change`,
        evidence: `- ${exp}`,
        suggestion: `If intentional, verify all consumers are updated. Add to design-sheet breaking change list.`,
        confidence: 0.85,
      });
    }

    for (const sig of modifiedSignatures) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Exported function signature changed: ${sig}`,
        evidence: sig,
        suggestion: "Review callers of this function. Document the change in the design-sheet breaking changes section.",
        confidence: 0.75,
      });
    }

    return violations;
  }

  /** Find export removals: lines starting with `-` that contained `export` */
  private findRemovedExports(diff: string): string[] {
    const removed: string[] = [];
    const lines = diff.split("\n");
    for (const line of lines) {
      // Match removed export declarations
      const m = line.match(
        /^-\s*(?:export\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/,
      );
      if (m) removed.push(m[1]);
    }
    return removed;
  }

  /** Find function signature or type changes in the diff */
  private findModifiedSignatures(diff: string): string[] {
    const modified: string[] = [];
    const lines = diff.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("-") || line.startsWith("---")) continue;

      // Exported function with parameter change
      const removedFn = line.match(
        /^-\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
      );
      if (removedFn && !modified.includes(removedFn[1])) {
        modified.push(removedFn[1]);
        continue;
      }

      // Interface or type alias removal
      const removedType = line.match(
        /^-\s*(?:export\s+)?(?:interface|type)\s+(\w+)/,
      );
      if (removedType && !modified.includes(removedType[1])) {
        modified.push(removedType[1]);
      }
    }

    return modified;
  }
}
