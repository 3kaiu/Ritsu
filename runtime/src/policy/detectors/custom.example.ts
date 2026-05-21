/**
 * 自定义检测器示例
 *
 * 将此文件复制到项目根目录的 `rules/detectors/` 目录下（编译为 .js 后），
 * Ritsu 将自动加载并注册。
 *
 * 部署方式：
 *   1. 编译: tsc src/policy/detectors/custom.example.ts --outDir rules/detectors/
 *   2. 或直接写 .js 文件到 rules/detectors/
 *   3. 确保文件导出了 createDetector 函数
 *
 * 文件名任意，但必须导出 createDetector 函数。
 */

import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation, DetectorType } from "../../policy/types.js";

/**
 * 自定义检测器工厂函数。
 * 返回一个实现了 DetectorPlugin 接口的对象。
 */
export function createDetector(): DetectorPlugin {
  return {
    type: "custom_example" as DetectorType, // 唯一标识符，在 anti-patterns.yaml 的 detector.type 中使用

    detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
      const violations: PolicyViolation[] = [];
      const content = ctx.content ?? "";

      // 示例：检测 TODO 注释
      if (/\bTODO\b/i.test(content)) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: "Found TODO comment — should be tracked in issue tracker",
          evidence: content.match(/.{0,30}TODO.{0,30}/i)?.[0] ?? "TODO",
          suggestion: "Create an issue and reference it instead of leaving TODO",
        });
      }

      return violations;
    },
  };
}

/**
 * 在 anti-patterns.yaml 中使用自定义检测器：
 *
 * ```yaml
 * global:
 *   - id: no-todos
 *     name: "No TODO comments in code"
 *     severity: warn
 *     detector:
 *       type: custom_example
 *       target: artifact_content
 * ```
 */
