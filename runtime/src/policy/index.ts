import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";
import type { PolicyCheckContext, PolicyViolation } from "./types.js";
import { loadPolicies } from "./loader.js";
import { reconcilePreferences } from "./detectors/ast-grep-reconciler.js";
import { getDetector, clearPluginCache } from "./plugin-loader.js";

export { reconcilePreferences };
export { clearPluginCache };

export function evaluatePolicies(ctx: PolicyCheckContext): { passed: boolean; violations: PolicyViolation[] } {
  const rules = loadPolicies();
  const violations: PolicyViolation[] = [];

  // Initialize and pre-warm AST cache
  if (!ctx.astCache) {
    ctx.astCache = new Map();
  }

  const root = getProjectRoot();
  const scanFiles = ctx.context?.scan_files?.length
    ? ctx.context.scan_files
    : ctx.context?.in_scope_files;

  if (scanFiles && scanFiles.length > 0) {
    for (const f of scanFiles) {
      const absPath = resolve(root, f);
      if (existsSync(absPath) && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(absPath)) {
        try {
          const content = readFileSync(absPath, "utf-8");
          const sourceFile = ts.createSourceFile(
            absPath,
            content,
            ts.ScriptTarget.Latest,
            true
          );
          ctx.astCache.set(absPath, { sourceFile, content });
        } catch {
          // ignore read or parse failures
        }
      }
    }
  }

  if (ctx.target && ctx.content !== undefined) {
    const absTarget = resolve(root, ctx.target);
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(absTarget)) {
      try {
        const sourceFile = ts.createSourceFile(
          absTarget,
          ctx.content,
          ts.ScriptTarget.Latest,
          true
        );
        ctx.astCache.set(absTarget, { sourceFile, content: ctx.content });
      } catch {}
    }
  }


  for (const rule of rules) {
    // 1. Check exemptions
    let exempted = false;
    if (rule.exemption && Array.isArray(rule.exemption)) {
      for (const ex of rule.exemption) {
        if (ex.when) {
          const matchSkill = !ex.when.skill || ex.when.skill === ctx.context?.skill;
          const matchTarget = !ex.when.target_file || (ctx.target && ctx.target.endsWith(ex.when.target_file));
          if (matchSkill && matchTarget) {
            exempted = true;
            break;
          }
        }
      }
    }
    if (exempted) continue;

    // 2. Run detector (from plugin loader — supports user-defined plugins)
    if (rule.detector) {
      const detector = getDetector(rule.detector.type);
      if (!detector) {
        throw new Error(`Detector type '${rule.detector.type}' is not registered. Used in rule '${rule.id}'.`);
      }

      if (rule.detector.target === "artifact_content" && ctx.action !== "write_artifact") continue;
      if (rule.detector.target === "diff" && ctx.action !== "commit_diff") {
        if (rule.detector.type !== "ast_grep" && rule.detector.type !== "ast") continue;
      }

      const ruleViolations = detector.detect(rule, ctx);
      violations.push(...ruleViolations);
    }
  }

  for (const v of violations) {
    if (v.evidence && v.evidence.length > 200) v.evidence = v.evidence.slice(0, 200) + "...";
  }

  const isBlocked = violations.some(v => v.severity === "fatal" || v.severity === "hard_stop");

  return {
    passed: !isBlocked,
    violations,
  };
}
