/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Ritsu 内部工具编排层
 *
 * 用户只通过 /r-think /r-dev /r-review 与 Ritsu 交互。
 * 此模块在 orchestration 内部自动调用底层工具
 * （Superpowers、CodeGraph、OpenSpec、MCP 工具集），
 * 对用户完全透明。所有 MCP 工具由 bootstrap 自动配置。
 */

import { existsSync, } from "node:fs";
import { resolve } from "node:path";
import { safeExecSync } from "../shared.js";

// ─── Superpowers 内部调用 ─────────────────────────────────────

const BRAINSTORMING_TIMEOUT = 60_000;

export function hasSuperpowers(): boolean {
  try {
    safeExecSync("which", ["superpowers"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      safeExecSync("npx", ["-y", "superpowers", "--version"], {
        stdio: "ignore",
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export interface BrainstormResult {
  ok: boolean;
  requirements?: string[];
  designNotes?: string;
  rawOutput?: string;
}

/**
 * 内部调用 Superpowers brainstorming 提取需求。
 * 对用户透明 —— 用户只看到 Ritsu 的设计产出。
 */
export function runSuperpowersBrainstorming(topic: string): BrainstormResult {
  if (!hasSuperpowers()) {
    return { ok: false };
  }
  try {
    const output = safeExecSync(
      "superpowers",
      ["brainstorming", "--json"],
      {
        input: topic,
        timeout: BRAINSTORMING_TIMEOUT,
        stdio: ["pipe", "pipe", "pipe"],
      }
    ).toString().trim();

    const lines = output.split("\n").filter((l: string) => l.trim());
    return {
      ok: true,
      requirements: lines,
      rawOutput: output,
    };
  } catch (e) {
    return { ok: false };
  }
}

// ─── CodeGraph 内部调用 ────────────────────────────────────────

export function hasCodeGraph(): boolean {
  try {
    safeExecSync("which", ["codegraph"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface CodeGraphContext {
  symbols: string[];
  files: string[];
  raw?: string;
}

/**
 * 内部调用 CodeGraph 提取代码图上下文。
 * preflight 自动调用，不需要用户手动触发。
 */
export function fetchCodeGraphContext(files: string[]): CodeGraphContext {
  if (!hasCodeGraph() || files.length === 0) {
    return { symbols: [], files: [] };
  }
  try {
    const output = safeExecSync("codegraph", ["affected", "--json", ...files.slice(0, 10)], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).toString().trim();
    const parsed = JSON.parse(output) as Array<{ id?: string; file?: string }>;
    return {
      symbols: parsed.map((n) => n.id ?? "").filter(Boolean),
      files: [...new Set(parsed.map((n) => n.file ?? "").filter(Boolean))],
      raw: output,
    };
  } catch {
    return { symbols: [], files: [] };
  }
}

// ─── OpenSpec 内部调用 ─────────────────────────────────────────

export function hasOpenSpec(root: string): boolean {
  return existsSync(resolve(root, "openspec"));
}

export function getOpenSpecContracts(root: string, changeId?: string): unknown[] {
  if (!hasOpenSpec(root)) return [];

  try {
    const { syncOpenSpecContracts } = require("../openspec-bridge.js") as typeof import("../openspec-bridge.js");
    const ret = syncOpenSpecContracts(root, changeId);
    if ("error" in ret) return [];
    return ret.contracts;
  } catch {
    return [];
  }
}

// ─── 工具就绪状态报告 ─────────────────────────────────────────

export interface ToolReadiness {
  superpowers: boolean;
  codegraph: boolean;
  openspec: boolean;
  native: boolean;
}

/**
 * 报告当前环境中哪些底层工具可用。
 * 供 orchestration 层决定调用策略。
 */
export function getToolReadiness(root: string): ToolReadiness {
  return {
    superpowers: hasSuperpowers(),
    codegraph: hasCodeGraph(),
    openspec: hasOpenSpec(root),
    native: existsSync(resolve(root, "runtime/native/ritsu-native.darwin-arm64.node")),
  };
}
