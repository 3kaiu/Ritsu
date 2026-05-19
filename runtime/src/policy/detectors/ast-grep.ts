import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

    const languages =
      typeof config.languages === "string"
        ? config.languages
        : Array.isArray(config.languages)
          ? config.languages.join(",")
          : "typescript,javascript";

    try {
      const stdout = execFileSync(
        "npx",
        [
          "--yes",
          "@ast-grep/cli",
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
        return [];
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
