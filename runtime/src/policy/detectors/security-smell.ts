/**
 * Security Smell 检测器 (R-6)
 *
 * 基于正则的代码安全气味扫描，覆盖：
 * - 动态代码执行 (eval, Function constructor)
 * - XSS 向量 (innerHTML, dangerouslySetInnerHTML, document.write)
 * - 命令注入 (child_process.exec 拼接用户输入)
 * - SQL 注入 (原始字符串拼接)
 * - 路径遍历 (fs 操作拼接用户输入)
 */

import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

interface SmellPattern {
  id: string;
  regex: RegExp;
  message: string;
  suggestion: string;
}

const PATTERNS: SmellPattern[] = [
  {
    id: "suspicious-eval",
    regex: /\beval\s*\(/g,
    message: "Dynamic code execution via eval() detected",
    suggestion: "Avoid eval(). Use structured alternatives (JSON.parse, Function constructor with caution, or proper parsers)",
  },
  {
    id: "suspicious-function-constructor",
    regex: /\bnew\s+Function\s*\(/g,
    message: "Dynamic code execution via new Function() detected",
    suggestion: "Avoid new Function(). Use higher-order functions or proper evaluation strategies",
  },
  {
    id: "xss-dangerously-set-inner-html",
    regex: /\bdangerouslySetInnerHTML\s*=\s*\{/g,
    message: "React dangerouslySetInnerHTML — potential XSS vector",
    suggestion: "Use textContent-based alternatives or sanitize input with DOMPurify before setting HTML",
  },
  {
    id: "xss-inner-html",
    regex: /\.innerHTML\s*=\s*(?!\s*['"`][^'"`]*['"`])/g,
    message: "Assignment to .innerHTML — potential XSS vector",
    suggestion: "Use .textContent or sanitize the assigned value. If intentional, add a // SAFE: comment explaining why",
  },
  {
    id: "xss-document-write",
    regex: /\.write\s*\(\s*(?!['"`][\w\s.-]*['"`])/g,
    message: "Call to document.write() — deprecated and XSS-prone",
    suggestion: "Use DOM APIs (createElement, appendChild) instead of document.write()",
  },
  {
    id: "command-injection-exec",
    regex: /\bexec\s*\(\s*[`'"]?(?!['"`][^'"`]*['"`])/g,
    message: "Potentially unsanitized input passed to exec() — command injection risk",
    suggestion: "Use spawn() with argument arrays instead of exec() with string templating. Validate all inputs.",
  },
  {
    id: "sql-injection-concat",
    regex: /(["'`])\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b.*\$\{/gi,
    message: "SQL query with template literal interpolation — SQL injection risk",
    suggestion: "Use parameterized queries (prepared statements) instead of string interpolation",
  },
  {
    id: "path-traversal-fs",
    regex: /\b(?:readFile|writeFile|createReadStream|createWriteStream)\s*\(\s*[^)]*\$\{/g,
    message: "File system operation with template interpolation — path traversal risk",
    suggestion: "Resolve paths with path.resolve() and validate against an allowed root directory",
  },
];

export class SecuritySmellDetector implements DetectorPlugin {
  type = "security_smell" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const content = ctx.content;
    if (!content) return violations;

    const targetPath = ctx.target || "";

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      const matches = content.matchAll(pattern.regex);
      let matchCount = 0;

      for (const match of matches) {
        matchCount++;
        const snippet = match[0]?.slice(0, 80) ?? pattern.id;
        const lineCol = this.estimatePosition(content, match.index ?? 0);

        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `${pattern.message} (${pattern.id})`,
          evidence: `${targetPath}:${lineCol} — ${snippet}`,
          suggestion: pattern.suggestion,
          confidence: 0.9,
        });

        // Limit to 5 violations per pattern to avoid noise
        if (matchCount >= 5) break;
      }
    }

    return violations;
  }

  private estimatePosition(content: string, offset: number): string {
    const before = content.slice(0, offset);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const col = lastNewline === -1 ? offset + 1 : offset - lastNewline;
    return `${line}:${col}`;
  }
}
