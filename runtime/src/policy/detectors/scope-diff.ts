import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class ScopeDiffDetector implements DetectorPlugin {
  type = "scope_diff" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Only apply if action is commit_diff
    if (ctx.action !== "commit_diff") {
      return violations;
    }

    // If no in_scope_files defined, we can't check
    if (!ctx.context?.in_scope_files || ctx.context.in_scope_files.length === 0) {
      return violations;
    }

    const inScope = new Set(ctx.context.in_scope_files);
    const modifiedFiles: string[] = [];

    // If content is provided, assume it's `git diff --name-only` output
    if (ctx.content) {
      const files = ctx.content.split("\n").map(f => f.trim()).filter(Boolean);
      modifiedFiles.push(...files);
    } else if (ctx.target) {
      // If target is provided, assume it's a single file path
      modifiedFiles.push(ctx.target);
    }

    for (const file of modifiedFiles) {
      // Check if file is in scope, or if its directory is in scope
      let isAllowed = false;
      for (const scopePath of inScope) {
        if (file === scopePath || file.startsWith(scopePath + "/")) {
          isAllowed = true;
          break;
        }
      }

      if (!isAllowed) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `File '${file}' was modified but is not listed in the design-sheet in_scope.`,
          evidence: file,
          suggestion: `Add '${file}' to the design-sheet in_scope, or revert the changes to this file.`
        });
      }
    }

    return violations;
  }
}
