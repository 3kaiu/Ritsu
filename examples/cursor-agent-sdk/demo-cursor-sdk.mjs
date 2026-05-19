#!/usr/bin/env node
/**
 * Cursor Agent SDK × Ritsu coordination-sheet 集成示例（可选，非 core）
 *
 * 前置：npm i @cursor/sdk（在消费方项目，非 Ritsu runtime 硬依赖）
 * 环境：CURSOR_API_KEY
 *
 * 流程：
 *   1. Ritsu think 产出 coordination-sheet（含 task_assignments / span 表）
 *   2. 本脚本解析 sheet，为每个 task 调用 Agent.create
 *   3. 子 agent 通过 RITSU_TRACE_PARENT 与 ritsu file-lease 协作
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const COORD_SHEET = process.env.RITSU_COORD_SHEET ?? ".ritsu/coordination-sheet-01.md";

function parseSpanRows(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(
      /^\|\s*(span-[a-z0-9-]+)\s*\|\s*(\w+)\s*\|\s*([^|]+)\|\s*(\w+)\s*\|/i,
    );
    if (m) {
      rows.push({ span_id: m[1], role: m[2], description: m[3].trim(), priority: m[4] });
    }
  }
  return rows;
}

async function main() {
  const root = process.env.RITSU_PROJECT_ROOT ?? process.cwd();
  const sheetPath = resolve(root, COORD_SHEET);
  if (!existsSync(sheetPath)) {
    console.error(`Missing coordination sheet: ${sheetPath}`);
    console.error("Run Ritsu /r-think P2 multi-agent path first.");
    process.exit(1);
  }

  const tasks = parseSpanRows(readFileSync(sheetPath, "utf-8"));
  if (tasks.length === 0) {
    console.error("No span rows parsed from coordination sheet.");
    process.exit(1);
  }

  let Agent;
  try {
    ({ Agent } = await import("@cursor/sdk"));
  } catch {
    console.log("ℹ️  @cursor/sdk not installed — dry-run mode\n");
    for (const t of tasks) {
      console.log(`  [dry-run] Agent.create({ prompt: "${t.description}", metadata: { span_id: "${t.span_id}", role: "${t.role}" } })`);
    }
    console.log("\nInstall: npm i @cursor/sdk && export CURSOR_API_KEY=...");
    return;
  }

  const parentTrace = process.env.RITSU_TRACE_PARENT;
  for (const t of tasks) {
    const agent = await Agent.create({
      instructions: `You are Ritsu executor (${t.role}). Claim task ${t.span_id} via ritsu_claim_task before editing files.`,
      metadata: { span_id: t.span_id, role: t.role, ritsu_trace_parent: parentTrace },
    });
    await agent.prompt(
      `${t.description}\n\nUse Ritsu MCP: open_span → claim_file → ritsu_preflight(stage=dev) → run_quality_gates → close_span.`,
    );
    console.log(`✅ Dispatched: ${t.span_id} (${t.role})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
