/**
 * Superpowers 工作流桥接
 *
 * 将 Ritsu 的治理层（策略引擎、质量门禁、ctx 追踪）
 * 包裹在 Superpowers 的 /brainstorming → /writing-plans → /subagent-driven-development 流程外。
 *
 * 当检测到 Superpowers 安装时，Ritsu 自动路由到对应阶段。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// ─── Superpowers 检测 ─────────────────────────────────────────

export function hasSuperpowers(root: string): boolean {
  // Check AGENTS.md for superpowers reference
  const agentsPath = resolve(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, "utf-8");
    if (/superpowers/i.test(content)) return true;
  }

  // Check CLAUDE.md for superpowers reference
  const claudeMd = resolve(root, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const content = readFileSync(claudeMd, "utf-8");
    if (/superpowers/i.test(content)) return true;
  }

  // Try invoking superpowers CLI
  try {
    execFileSync("which", ["superpowers"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ─── Phase Mapping ────────────────────────────────────────────

export const SUPERPOWERS_PHASE_MAP: Record<string, string> = {
  brainstorming: "think",
  "writing-plans": "think",
  "subagent-driven-development": "dev",
  "test-driven-development": "hunt",
  "requesting-code-review": "review",
  "finishing-a-development-branch": "review",
};

export function getRitsuStageForSuperpowersPhase(phase: string): string {
  return SUPERPOWERS_PHASE_MAP[phase] ?? "dev";
}

// ─── Preflight Wrapper ────────────────────────────────────────

export type SuperpowersPreflightResult = {
  hasSuperpowers: boolean;
  currentPhase: string | null;
  ritsuStage: string;
};

/**
 * 检测当前会话是否在 Superpowers 流程中，
 * 返回对应 Ritsu 阶段供 preflight 使用。
 */
export function detectSuperpowersPhase(root: string): SuperpowersPreflightResult {
  const spAvailable = hasSuperpowers(root);
  if (!spAvailable) {
    return { hasSuperpowers: false, currentPhase: null, ritsuStage: "dev" };
  }

  // Try to detect current phase from recent ctx events
  const ctxDir = resolve(root, ".ritsu");
  if (existsSync(ctxDir)) {
    const files = readdirSync(ctxDir)
      .filter((f) => f.startsWith("ctx-") && f.endsWith(".jsonl"))
      .sort();

    for (const file of files.slice(-1)) {
      const content = readFileSync(join(ctxDir, file), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]) as Record<string, unknown>;
          if (event.phase && typeof event.phase === "string") {
            return {
              hasSuperpowers: true,
              currentPhase: event.phase,
              ritsuStage: getRitsuStageForSuperpowersPhase(event.phase),
            };
          }
        } catch { /* skip */ }
      }
    }
  }

  return { hasSuperpowers: true, currentPhase: null, ritsuStage: "dev" };
}
