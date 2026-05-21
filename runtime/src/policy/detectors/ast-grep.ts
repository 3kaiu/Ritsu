import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

type AstGrepMatch = {
  ruleId?: string;
  message?: string;
  file?: string;
  text?: string;
};

function parseAstGrepJson(stdout: string): AstGrepMatch[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((entry) => normalizeMatch(entry));
    }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.matches)) {
        return obj.matches.flatMap((m) => normalizeMatch(m));
      }
    }
  } catch {
    // ast-grep may emit one JSON object per line
  }

  const matches: AstGrepMatch[] = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    try {
      matches.push(...normalizeMatch(JSON.parse(line) as unknown));
    } catch {
      // ignore non-json lines
    }
  }
  return matches;
}

function normalizeMatch(entry: unknown): AstGrepMatch[] {
  if (typeof entry !== "object" || entry === null) return [];
  const obj = entry as Record<string, unknown>;
  const ruleId =
    typeof obj.ruleId === "string"
      ? obj.ruleId
      : typeof obj.id === "string"
        ? obj.id
        : undefined;
  const file =
    typeof obj.file === "string"
      ? obj.file
      : typeof obj.path === "string"
        ? obj.path
        : undefined;
  const text =
    typeof obj.text === "string"
      ? obj.text
      : typeof obj.matched === "string"
        ? obj.matched
        : undefined;

  if (!ruleId && !text) return [];
  return [{ ruleId, file, text, message: typeof obj.message === "string" ? obj.message : undefined }];
}

function findAstGrepBinary(root: string): { binary: string; args: string[] } {
  const candidates = [
    resolve(root, "node_modules/.bin/ast-grep"),
    resolve(root, "node_modules/.bin/sg"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return { binary: path, args: [] };
    }
  }
  return { binary: "npx", args: ["--yes", "@ast-grep/cli"] };
}

function fallbackScan(files: string[], root: string, rule: PolicyRule): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const hintPrefix = `[ritsu] 💡 提示：检测到当前宿主系统未全局安装 ast-grep，已自动降级为原生安全解析。建议运行 npm i -g @ast-grep/cli 获得更强的底线检测。\n`;

  for (const file of files) {
    const fileRel = file.replace(root + "/", "");
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const ext = file.split(".").pop()?.toLowerCase();
    const isJsTs = ext && ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext);

    if (isJsTs) {
      try {
        const sourceFile = ts.createSourceFile(
          file,
          content,
          ts.ScriptTarget.Latest,
          true
        );

        const checkNode = (node: ts.Node) => {
          // Check debugger
          if (node.kind === ts.SyntaxKind.DebuggerStatement) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              rule_id: rule.id,
              severity: rule.severity,
              message: `${hintPrefix}Avoid debugger statements (detected via TypeScript AST).`,
              evidence: `${fileRel}:${line + 1}:${character + 1} - debugger;`,
              confidence: 0.95,
            });
          }

          // Check empty catch block
          if (ts.isCatchClause(node)) {
            const block = node.block;
            if (block && block.statements.length === 0) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(block.getStart());
              violations.push({
                rule_id: rule.id,
                severity: rule.severity,
                message: `${hintPrefix}Avoid empty catch blocks (detected via TypeScript AST).`,
                evidence: `${fileRel}:${line + 1}:${character + 1} - empty catch block`,
                confidence: 0.95,
              });
            }
          }

          // Check console.log call
          if (ts.isCallExpression(node)) {
            const expression = node.expression;
            if (ts.isPropertyAccessExpression(expression)) {
              if (
                ts.isIdentifier(expression.expression) &&
                expression.expression.text === "console" &&
                expression.name.text === "log"
              ) {
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                violations.push({
                  rule_id: rule.id,
                  severity: rule.severity,
                  message: `${hintPrefix}Avoid console.log in production paths (detected via TypeScript AST).`,
                  evidence: `${fileRel}:${line + 1}:${character + 1} - console.log(...)`,
                  confidence: 0.95,
                });
              }
            }
          }

          ts.forEachChild(node, checkNode);
        };

        checkNode(sourceFile);
      } catch {
        // ignore & fallback to regex
      }
    }

    // Always do a regex check as backup or for non-JS/TS files
    if (violations.length === 0) {
      const debuggerMatches = [...content.matchAll(/\bdebugger\b/g)];
      for (let i = 0; i < debuggerMatches.length; i++) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `${hintPrefix}Avoid debugger statements (detected via regex).`,
          evidence: `${fileRel} - debugger`,
          confidence: 0.7,
        });
      }

      const catchMatches = [...content.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/g)];
      for (let i = 0; i < catchMatches.length; i++) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `${hintPrefix}Avoid empty catch blocks (detected via regex).`,
          evidence: `${fileRel} - empty catch block`,
          confidence: 0.7,
        });
      }

      const consoleMatches = [...content.matchAll(/\bconsole\.log\s*\(/g)];
      for (let i = 0; i < consoleMatches.length; i++) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `${hintPrefix}Avoid console.log in production paths (detected via regex).`,
          evidence: `${fileRel} - console.log`,
          confidence: 0.7,
        });
      }
    }
  }

  return violations;
}

const extToLangMap: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  go: "go",
  py: "python",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  html: "html",
  css: "css",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
};

export class AstGrepDetector implements DetectorPlugin {
  type = "ast_grep" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const config = rule.detector;
    if (!config) return [];

    const root = getProjectRoot();
    const ruleDirRel =
      typeof config.rule_dir === "string" ? config.rule_dir : "rules/ast-grep";
    const ruleDir = resolve(root, ruleDirRel);
    if (!existsSync(ruleDir)) return [];

    const scanFiles = ctx.context?.scan_files?.length
      ? ctx.context.scan_files
      : ctx.context?.in_scope_files;

    if (!scanFiles?.length) return [];

    const existing = scanFiles
      .map((f) => resolve(root, f))
      .filter((abs) => existsSync(abs));
    if (existing.length === 0) return [];

    const detectedLangs = new Set<string>();
    for (const f of existing) {
      const ext = f.split(".").pop()?.toLowerCase();
      if (ext && extToLangMap[ext]) {
        detectedLangs.add(extToLangMap[ext]);
      }
    }

    const configuredLangs =
      typeof config.languages === "string"
        ? [config.languages]
        : Array.isArray(config.languages)
          ? config.languages
          : [];

    const langSet = new Set<string>(configuredLangs);
    if (langSet.size === 0) {
      langSet.add("typescript");
      langSet.add("javascript");
    }

    for (const lang of detectedLangs) {
      langSet.add(lang);
    }

    const languages = Array.from(langSet).join(",");

    const spec = findAstGrepBinary(root);

    // Verify if ast-grep binary works
    let astGrepOk = false;
    try {
      execFileSync(spec.binary, [...spec.args, "--version"], { cwd: root, stdio: "ignore" });
      astGrepOk = true;
    } catch {
      // ast-grep binary not executable or missing
    }

    if (!astGrepOk) {
      return fallbackScan(existing, root, rule);
    }

    try {
      const stdout = execFileSync(
        spec.binary,
        [
          ...spec.args,
          "scan",
          "--rule-dir",
          ruleDir,
          "--json",
          "--lang",
          languages,
          ...existing,
        ],
        { cwd: root, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 },
      );

      const matches = parseAstGrepJson(stdout);
      return matches.map((m) => ({
        rule_id: rule.id,
        severity: rule.severity,
        message: m.message ?? `ast-grep rule matched: ${m.ruleId ?? "unknown"}`,
        evidence: [m.file, m.text].filter(Boolean).join(": "),
        confidence: 0.85,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT") || message.includes("not found")) {
        return fallbackScan(existing, root, rule);
      }
      return [
        {
          rule_id: rule.id,
          severity: "warn",
          message: `ast-grep scan failed: ${message}`,
          confidence: 0.5,
        },
      ];
    }
  }
}
