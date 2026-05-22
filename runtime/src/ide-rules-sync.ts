/**
 * IDE Rule Active Sync
 *
 * 每次 preflight 执行后，将当前架构上下文（Mermaid 依赖图、活动规则、架构漂移）
 * 动态写入 IDE 规则文件，实现：
 * - Cursor: .cursor/rules/ritsu-arch.mdc（自动热加载）
 * - Claude Code: .claude/rules/ritsu-arch.md（会话启动时读取）
 *
 * 让 AI 在 IDE 中键入每一行前，都已感知最新的架构红线。
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  buildArchitectureFingerprint,
  buildArchitectureContext,
} from "./orchestration/architecture-analyzer.js";
import type { ArchitectureFingerprint, LayerRule } from "./orchestration/architecture-analyzer.js";

export { type ArchitectureFingerprint, type LayerRule };

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function buildConstraintsBlock(fp: ArchitectureFingerprint, drift?: LayerRule[]): string {
  const lines: string[] = [];

  // Structural rules from fingerprint
  for (const r of fp.rules) {
    lines.push(`- [${r.severity}] ${r.message}`);
  }

  // Drift violations from the current diff
  if (drift && drift.length > 0) {
    if (lines.length === 0) lines.push("<!-- No permanent rules -->");
    lines.push("");
    lines.push("### Active Drift");
    for (const d of drift) {
      const suggestion = d.suggestion ? ` — ${d.suggestion}` : "";
      lines.push(`- [${d.severity}] ${d.message}${suggestion}`);
    }
  }

  return lines.join("\n");
}

function buildMermaidBlock(fp: ArchitectureFingerprint): string {
  const ctx = buildArchitectureContext(fp);
  return (ctx.mermaid as string) || "graph TD\n  No dependencies captured yet.";
}

function buildModuleSummary(fp: ArchitectureFingerprint): string {
  return fp.modules.map((m) => `- ${m.name}`).join("\n");
}

/**
 * 将当前架构上下文同步到 IDE 规则文件。
 *
 * @param root        项目根目录
 * @param stage       当前阶段 (think / dev / review)
 * @param fingerprint 架构指纹（可选，缺失时自动构建）
 * @param drift       当前 diff 的架构漂移（可选）
 * @param taskSummary 当前任务描述（可选，暂未使用但预留）
 * @returns          是否写入成功
 */
export function syncArchitectureToIDERules(
  root: string,
  stage: string,
  fingerprint?: ArchitectureFingerprint,
  drift?: LayerRule[],
  _taskSummary?: string,
): boolean {
  try {
    const fp = fingerprint ?? buildArchitectureFingerprint(root);
    const mermaid = buildMermaidBlock(fp);
    const constraints = buildConstraintsBlock(fp, drift);
    const moduleSummary = buildModuleSummary(fp);
    const depCount = fp.dependencies.length;
    const modCount = fp.modules.length;

    // ─── Cursor .mdc rule ───
    const cursorContent = [
      "---",
      "description: Ritsu live architecture context — auto-synced after preflight",
      'globs: "*"',
      "---",
      `# Architecture Context — ${stage} stage`,
      "",
      `**Modules**: ${modCount} | **Cross-module deps**: ${depCount}`,
      "",
      "## Dependency Graph",
      "",
      "```mermaid",
      mermaid,
      "```",
      "",
      "## Active Constraints",
      "",
      constraints || "None",
    ].join("\n");

    const cursorPath = resolve(root, ".cursor", "rules", "ritsu-arch.mdc");
    ensureDir(cursorPath);
    writeFileSync(cursorPath, cursorContent, "utf-8");

    // ─── Claude Code rule ───
    const claudeContent = [
      `# Architecture Context — ${stage} stage (Ritsu Live Sync)`,
      "",
      `**Modules**: ${modCount} | **Cross-module deps**: ${depCount} | **Stage**: ${stage}`,
      "",
      "## Modules",
      "",
      moduleSummary || "None discovered yet.",
      "",
      "## Dependency Graph",
      "",
      "```mermaid",
      mermaid,
      "```",
      "",
      "## Active Constraints",
      "",
      constraints || "None",
    ].join("\n");

    const claudePath = resolve(root, ".claude", "rules", "ritsu-arch.md");
    ensureDir(claudePath);
    writeFileSync(claudePath, claudeContent, "utf-8");

    return true;
  } catch {
    return false;
  }
}
