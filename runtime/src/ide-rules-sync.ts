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

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
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

    // Sync loop instructions as well
    syncLoopInstructionsToIDE(root);

    return true;
  } catch {
    return false;
  }
}

export function syncLoopInstructionsToIDE(root: string): boolean {
  try {
    // ─── Cursor .mdc rule ───
    const cursorContent = [
      "---",
      "description: Ritsu Quality Gates & Autopilot Loop — auto-synced",
      'globs: "*"',
      "---",
      "# Ritsu Quality Gates & Autopilot Loop",
      "",
      "This rule forces the AI agent to automatically execute Ritsu's loops and verification checks.",
      "",
      "## Guidelines",
      "1. **DDD & Clean Architecture First**: When creating or modifying code, you MUST follow Clean Architecture (no reverse dependencies from Domain to Infrastructure/Application) and DDD principles (high module cohesion, low coupling).",
      "2. **File Naming & Clean Imports**: Name files logically after their domain functions. Avoid generic files like `utils.ts` or scattered single-interface files. Delete dead code, empty files, and unused imports.",
      "3. **Design-Stage Think Loop**: Before coding a complex task, you MUST trigger the Ritsu design refinement loop: `ritsu loop trigger think-refinement` or run Ritsu preflight to verify your design-sheet. Make sure all proposed changes pass design guardrails (DA-1 to DA-6). Specifically, you must compare at least two alternative algorithms with Big-O time/space complexity (DA-5) and evaluate alternative architectural options using a trade-off matrix (DA-6).",
      "4. **Trigger Quality Gates Automatically**: Before proposing any file modifications or declaring a task complete, you MUST invoke the MCP tool `ritsu_run_quality_gates` (or run `bun run --cwd runtime test` / `ritsu check --staged` in terminal) to verify tests, lint, and policy compliance.",
      "5. **Execute Self-Correction Loops**: If quality gates or design verification fail, DO NOT ask the user for help. Enter a self-correction loop (up to 3 iterations): inspect error logs, modify the code/design, and run verification again.",
      "6. **Emit Progress Events**: Keep Ritsu's task context synchronized by emitting lifecycle events (`started`, `done`, `failed`) via the `ritsu_emit_event` MCP tool.",
      "7. **Preflight Check**: Run `ritsu_preflight` when starting any new task.",
    ].join("\n");

    const cursorPath = resolve(root, ".cursor", "rules", "ritsu-loop.mdc");
    ensureDir(cursorPath);
    writeFileSync(cursorPath, cursorContent, "utf-8");

    // ─── Claude Code rule ───
    const claudeContent = [
      "# Ritsu Quality Gates & Autopilot Loop (Claude Code)",
      "",
      "This rule forces the AI agent to automatically execute Ritsu's loops and verification checks.",
      "",
      "## Guidelines",
      "1. **DDD & Clean Architecture First**: When creating or modifying code, you MUST follow Clean Architecture (no reverse dependencies from Domain to Infrastructure/Application) and DDD principles (high module cohesion, low coupling).",
      "2. **File Naming & Clean Imports**: Name files logically after their domain functions. Avoid generic files like `utils.ts` or scattered single-interface files. Delete dead code, empty files, and unused imports.",
      "3. **Design-Stage Think Loop**: Before coding a complex task, you MUST trigger the Ritsu design refinement loop: `ritsu loop trigger think-refinement` or run Ritsu preflight to verify your design-sheet. Make sure all proposed changes pass design guardrails (DA-1 to DA-6). Specifically, you must compare at least two alternative algorithms with Big-O time/space complexity (DA-5) and evaluate alternative architectural options using a trade-off matrix (DA-6).",
      "4. **Trigger Quality Gates Automatically**: Before proposing any file modifications or declaring a task complete, you MUST invoke the MCP tool `ritsu_run_quality_gates` (or run `bun run --cwd runtime test` / `ritsu check --staged` in terminal) to verify tests, lint, and policy compliance.",
      "5. **Execute Self-Correction Loops**: If quality gates or design verification fail, DO NOT ask the user for help. Enter a self-correction loop (up to 3 iterations): inspect error logs, modify the code/design, and run verification again.",
      "6. **Emit Progress Events**: Keep Ritsu's task context synchronized by emitting lifecycle events (`started`, `done`, `failed`) via the `ritsu_emit_event` MCP tool.",
      "7. **Preflight Check**: Run `ritsu_preflight` when starting any new task.",
    ].join("\n");

    const claudePath = resolve(root, ".claude", "rules", "ritsu-loop.md");
    ensureDir(claudePath);
    writeFileSync(claudePath, claudeContent, "utf-8");

    // ─── AGENTS.md update ───
    const agentsPath = resolve(root, "AGENTS.md");
    if (existsSync(agentsPath)) {
      let agentsContent = readFileSync(agentsPath, "utf-8");
      const autopilotHeader = "## AI Loop & Autopilot Guidelines";
      const autopilotBody = [
        autopilotHeader,
        "When you act as an AI agent (e.g. Antigravity, Claude Code, Cursor) in this repository:",
        "1. **DDD & Clean Architecture**: Follow Clean Architecture (no reverse dependencies from Domain to Infrastructure/Application) and DDD principles (high module cohesion, low coupling, no micro-file sprawl).",
        "2. **Auto Quality Gates**: Before proposing any code changes or declaring a task complete, you MUST run `ritsu_run_quality_gates` (or run `bun run --cwd runtime test` / `ritsu check --staged` in terminal) to check for tests, linting, and policy compliance.",
        "3. **Self-Correction**: If any checks fail, you MUST NOT ask the user for help immediately. Enter a self-correction loop (up to 3 times) to fix the errors and re-run quality gates.",
        "4. **Emit Progress Events**: Keep the lifecycle synced by calling the `ritsu_emit_event` tool whenever you start, succeed, or fail a task step.",
        "5. **Trigger Loops**: You can trigger a scheduled loop in the background or foreground using `ritsu loop trigger <loop-id>` (e.g. `test-augment`, `pr-review`, `think-refinement`).",
        "6. **Design-Stage Think Loop**: Trigger the refinement loop (`ritsu loop trigger think-refinement`) and ensure designs compare alternative algorithms (Big-O analysis) and architectural options (trade-off decision matrix) satisfying DA-1 to DA-6.",
        "",
      ].join("\n");

      const idx = agentsContent.indexOf(autopilotHeader);
      if (idx !== -1) {
        agentsContent = agentsContent.substring(0, idx) + autopilotBody;
      } else {
        if (!agentsContent.endsWith("\n")) {
          agentsContent += "\n";
        }
        agentsContent += "\n" + autopilotBody;
      }
      writeFileSync(agentsPath, agentsContent, "utf-8");
    }

    return true;
  } catch {
    return false;
  }
}
