import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import ts from "typescript";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

interface PreferenceRuleDoc {
  id: string;
  match_regex?: string;
  forbid_lib?: string;
  require_call?: string;
}

interface PreferencesDoc {
  rules?: PreferenceRuleDoc[];
  preferences?: PreferenceRuleDoc[];
}

function isPreferenceRule(value: unknown): value is PreferenceRuleDoc {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    (rule.match_regex === undefined || typeof rule.match_regex === "string") &&
    (rule.forbid_lib === undefined || typeof rule.forbid_lib === "string") &&
    (rule.require_call === undefined || typeof rule.require_call === "string")
  );
}

function extractMarkdownCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```[a-z0-9]*\r?\n([\s\S]*?)\r?\n```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      blocks.push(match[1]);
    }
  }
  return blocks;
}

function getCalleeText(expressionStr: string): string {
  const trimmed = expressionStr.trim();
  const callIndex = trimmed.indexOf("(");
  const callee = callIndex !== -1 ? trimmed.substring(0, callIndex) : trimmed;
  return callee.replace(/\s+/g, "");
}

export class PreferenceLintDetector implements DetectorPlugin {
  type = "preference_lint" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const root = getProjectRoot();
    const prefPath = resolve(root, ".ritsu/preferences.yaml");

    if (!existsSync(prefPath)) return violations;

    try {
      const raw = readFileSync(prefPath, "utf-8");
      const doc = yaml.load(raw) as PreferencesDoc | null;
      const prefRules = (
        Array.isArray(doc?.rules)
          ? doc.rules
          : Array.isArray(doc?.preferences)
            ? doc.preferences
            : []
      ).filter(isPreferenceRule);

      const content = ctx.content || "";
      const targetPath = ctx.target || "";
      const ext = targetPath.split(".").pop()?.toLowerCase() || "";
      const isSourceFile = ["ts", "js", "tsx", "jsx", "go", "py", "dart", "java", "c", "cpp", "rs", "rb"].includes(ext);
      const isJsOrTs = ["ts", "js", "tsx", "jsx"].includes(ext);

      for (const pref of prefRules) {
        // 1. match_regex (runs on entire content for all file types)
        if (pref.match_regex) {
          try {
            const regex = new RegExp(pref.match_regex, "g");
            if (regex.test(content)) {
              violations.push({
                rule_id: pref.id,
                severity: "warn",
                message: `Preference match: ${pref.id}`,
                evidence: pref.match_regex,
                suggestion: `Follow project preference defined in ${pref.id}`,
              });
            }
          } catch {
            // Ignore invalid match_regex patterns defined in preferences.yaml
          }
        }
      }

      const runFallback = () => {
        const contentsToSearch = isSourceFile
          ? [content]
          : extractMarkdownCodeBlocks(content);

        for (const pref of prefRules) {
          // forbid_lib
          if (pref.forbid_lib) {
            for (const block of contentsToSearch) {
              if (block.includes("import") && block.includes(pref.forbid_lib)) {
                violations.push({
                  rule_id: pref.id,
                  severity: "warn",
                  message: `Forbidden library '${pref.forbid_lib}' detected.`,
                  evidence: pref.forbid_lib,
                  suggestion: `Use project preferred alternatives.`,
                });
                break;
              }
            }
          }

          // require_call
          if (pref.require_call && isSourceFile) {
            if (!content.includes(pref.require_call)) {
              violations.push({
                rule_id: pref.id,
                severity: "warn",
                message: `Required call '${pref.require_call}' missing.`,
                evidence: pref.require_call,
                suggestion: `Add the required call to follow project patterns.`,
              });
            }
          }
        }
      };

      if (isJsOrTs) {
        try {
          const absPath = resolve(root, targetPath);
          const cached = ctx.astCache?.get(absPath);
          const sourceFile = cached
            ? cached.sourceFile
            : ts.createSourceFile(
                targetPath,
                content,
                ts.ScriptTarget.Latest,
                true
              );

          const imports: string[] = [];
          const calls: string[] = [];

          const visit = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) {
              if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                imports.push(node.moduleSpecifier.text);
              }
            } else if (ts.isCallExpression(node)) {
              // Handle require() and dynamic import()
              if (
                ts.isIdentifier(node.expression) &&
                node.expression.text === "require" &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
              ) {
                imports.push((node.arguments[0] as ts.StringLiteral).text);
              } else if (
                node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
              ) {
                imports.push((node.arguments[0] as ts.StringLiteral).text);
              }

              // Add callee expression text
              const calleeText = node.expression.getText(sourceFile).replace(/\s+/g, "");
              calls.push(calleeText);
            }

            ts.forEachChild(node, visit);
          };

          visit(sourceFile);

          for (const pref of prefRules) {
            // forbid_lib
            if (pref.forbid_lib) {
              if (
                imports.some(
                  (imp) => imp === pref.forbid_lib || imp.startsWith(pref.forbid_lib + "/")
                )
              ) {
                violations.push({
                  rule_id: pref.id,
                  severity: "warn",
                  message: `Forbidden library '${pref.forbid_lib}' detected via AST.`,
                  evidence: pref.forbid_lib,
                  suggestion: `Use project preferred alternatives.`,
                });
              }
            }

            // require_call
            if (pref.require_call) {
              const targetCallee = getCalleeText(pref.require_call);
              if (!calls.some((call) => call === targetCallee)) {
                violations.push({
                  rule_id: pref.id,
                  severity: "warn",
                  message: `Required call '${pref.require_call}' missing via AST.`,
                  evidence: pref.require_call,
                  suggestion: `Add the required call to follow project patterns.`,
                });
              }
            }
          }
        } catch {
          runFallback();
        }
      } else {
        runFallback();
      }
    } catch {
      // ignore parse errors
    }

    return violations;
  }
}

