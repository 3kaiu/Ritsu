import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import yaml from "js-yaml";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation, Severity } from "../types.js";
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

export interface FallbackRule {
  id: string;
  pattern: string;
  message: string;
  severity: Severity;
}

export class AstGrepRuleBridge {
  static loadRules(ruleDir: string): FallbackRule[] {
    const rules: FallbackRule[] = [];
    if (!existsSync(ruleDir)) return rules;

    try {
      const files = readdirSync(ruleDir);
      for (const file of files) {
        if (file.endsWith(".yml") || file.endsWith(".yaml")) {
          const content = readFileSync(resolve(ruleDir, file), "utf-8");
          const parsed = yaml.load(content) as {
            id?: unknown;
            message?: unknown;
            severity?: unknown;
            rule?: {
              pattern?: unknown;
            };
          } | null;
          if (
            parsed &&
            typeof parsed.id === "string" &&
            parsed.rule &&
            typeof parsed.rule.pattern === "string"
          ) {
            rules.push({
              id: parsed.id,
              pattern: parsed.rule.pattern,
              message: typeof parsed.message === "string" ? parsed.message : parsed.id,
              severity: (typeof parsed.severity === "string" ? parsed.severity : "warn") as Severity,
            });
          }
        }
      }
    } catch {
      // ignore errors
    }
    return rules;
  }

  static patternToRegex(pattern: string): RegExp {
    let escaped = pattern
      .replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
      .replace(/\s+/g, "\\s*");
    escaped = escaped.replace(/\\\$\\\$\\\$/g, "[\\s\\S]*?");
    escaped = escaped.replace(/\\\$[a-zA-Z_][a-zA-Z0-9_]*/g, "[a-zA-Z0-9_$]*");
    return new RegExp(escaped, "g");
  }

  static createAstMatcher(pattern: string): (node: ts.Node) => boolean {
    const norm = pattern.trim().replace(/\s+/g, " ");

    if (norm === "debugger") {
      return (node) => node.kind === ts.SyntaxKind.DebuggerStatement;
    }

    if (norm.startsWith("catch")) {
      return (node) => {
        if (ts.isCatchClause(node)) {
          const block = node.block;
          return block !== undefined && block.statements.length === 0;
        }
        return false;
      };
    }

    // Property access call: e.g. console.log($$$) or foo.bar($$$)
    const propertyAccessCallMatch = norm.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(\s*(?:\$\$\$|\$[a-zA-Z0-9_$]+)?\s*\)$/);
    if (propertyAccessCallMatch) {
      const [, obj, method] = propertyAccessCallMatch;
      return (node) => {
        if (ts.isCallExpression(node)) {
          const exp = node.expression;
          if (ts.isPropertyAccessExpression(exp)) {
            return (
              ts.isIdentifier(exp.expression) &&
              exp.expression.text === obj &&
              exp.name.text === method
            );
          }
        }
        return false;
      };
    }

    // Single identifier call: e.g. eval($$$) or alert($$$)
    const identifierCallMatch = norm.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\(\s*(?:\$\$\$|\$[a-zA-Z0-9_$]+)?\s*\)$/);
    if (identifierCallMatch) {
      const [, func] = identifierCallMatch;
      return (node) => {
        if (ts.isCallExpression(node)) {
          const exp = node.expression;
          return ts.isIdentifier(exp) && exp.text === func;
        }
        return false;
      };
    }

    // Default fallback
    return () => false;
  }
}

function fallbackScan(files: string[], root: string, rule: PolicyRule, ctx?: PolicyCheckContext): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const hintPrefix = `[ritsu] 💡 提示：检测到当前宿主系统未全局安装 ast-grep，已自动降级为原生安全解析。建议运行 npm i -g @ast-grep/cli 获得更强的底线检测。\n`;

  const config = rule.detector;
  const ruleDirRel = typeof config?.rule_dir === "string" ? config.rule_dir : "rules/ast-grep";
  const ruleDir = resolve(root, ruleDirRel);

  let loadedRules = AstGrepRuleBridge.loadRules(ruleDir);
  if (loadedRules.length === 0) {
    loadedRules = [
      {
        id: "ritsu-no-debugger",
        pattern: "debugger",
        message: "Remove debugger statements before commit",
        severity: "error",
      },
      {
        id: "ritsu-no-empty-catch",
        pattern: "catch ($E) {\n}",
        message: "Empty catch blocks hide failures (AP-7 silent failures)",
        severity: "warn",
      },
      {
        id: "ritsu-no-console-log",
        pattern: "console.log($$$)",
        message: "Avoid console.log in production paths (use structured logging)",
        severity: "warn",
      },
    ];
  }

  // Precompile matchers
  const matchers = loadedRules.map((r) => ({
    rule: r,
    astMatcher: AstGrepRuleBridge.createAstMatcher(r.pattern),
    regex: AstGrepRuleBridge.patternToRegex(r.pattern),
  }));

  for (const file of files) {
    const fileRel = file.replace(root + "/", "");
    let content: string;

    const cached = ctx?.astCache?.get(file);
    if (cached) {
      content = cached.content;
    } else {
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }
    }

    const ext = file.split(".").pop()?.toLowerCase();
    const isJsTs = ext && ["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext);

    const fileViolations: PolicyViolation[] = [];

    if (isJsTs) {
      try {
        const sourceFile = cached
          ? cached.sourceFile
          : ts.createSourceFile(
              file,
              content,
              ts.ScriptTarget.Latest,
              true
            );

        const checkNode = (node: ts.Node) => {
          for (const m of matchers) {
            if (m.astMatcher(node)) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              fileViolations.push({
                rule_id: m.rule.id,
                severity: m.rule.severity,
                message: `${hintPrefix}${m.rule.message}`,
                evidence: `${fileRel}:${line + 1}:${character + 1} - ${node.getText(sourceFile).slice(0, 100)}`,
                confidence: 0.95,
              });
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
    if (fileViolations.length === 0) {
      for (const m of matchers) {
        m.regex.lastIndex = 0;
        const matches = [...content.matchAll(m.regex)];
        for (const match of matches) {
          fileViolations.push({
            rule_id: m.rule.id,
            severity: m.rule.severity,
            message: `${hintPrefix}${m.rule.message} (detected via regex)`,
            evidence: `${fileRel} - ${match[0].slice(0, 100)}`,
            confidence: 0.7,
          });
        }
      }
    }

    violations.push(...fileViolations);
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
      return fallbackScan(existing, root, rule, ctx);
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
        return fallbackScan(existing, root, rule, ctx);
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
