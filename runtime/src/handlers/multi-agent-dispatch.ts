/**
 * Multi-Agent Dispatch MCP Tool
 *
 * Exposes the multi-agent orchestration engine as an MCP tool.
 * Agents are dispatched via ritsu_launch_agent and results are aggregated.
 *
 * This is the primary entry point for the /r-dev multi-agent path:
 *   ritsu_dispatch_task(agents: 2, contracts: ["C1", "C2"])
 *   → launches 2 agents in parallel
 *   → cross-reviews
 *   → returns conflicts + unified summary
 *
 * v8.2.0
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectRoot, textResult, structuredError, ts } from "./_utils.js";
import { launchAgent } from "./launch-agent.js";
import {
  findLatestDesignSheet,
  readDesignSheet,
  orchestrateMultiAgent,
  type AgentResult,
} from "../orchestration/multi-agent.js";

/**
 * Wrapper that calls launchAgent and converts the result to AgentResult.
 */
async function launchAndCollect(
  prompt: string,
  label: string,
  traceId?: string,
): Promise<AgentResult> {
  const result = await launchAgent({
    prompt,
    agent_type: "claude",
    timeout_ms: 300_000,
    trace_id: traceId,
    span_id: label,
  });

  return {
    agent_id: result.agent_id,
    sub_task_id: label,
    contract_id: label.includes("(") && label.endsWith(")")
      ? label.slice(label.indexOf("(") + 1, -1)
      : label,
    ok: result.ok,
    output: result.output,
    artifacts: [],
    modified_files: extractModifiedFiles(result.output),
    violations: extractViolations(result.output),
    quality_gates_passed: result.ok, // agent exit code 0 = gates passed
    duration_ms: result.duration_ms,
  };
}

/**
 * Extract modified files from agent output by looking for file paths.
 */
function extractModifiedFiles(output: string): string[] {
  const files: string[] = [];
  // Match common file path patterns: src/xxx.ts, path/to/file.tsx, etc.
  const fileRegex = /`([^`]+\.(?:ts|tsx|js|jsx|py|go|rs|vue|css|scss|json|md))`/g;
  let match;
  const seen = new Set<string>();

  while ((match = fileRegex.exec(output)) !== null) {
    const file = match[1];
    if (!file.includes("node_modules") && !seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }

  return files.slice(0, 30);
}

/**
 * Extract policy violations from agent output.
 */
function extractViolations(output: string): string[] {
  const violations: string[] = [];
  // Match ritsu violation patterns: AP-1, R-3, etc.
  const violationRegex = /\b(AP-\d+|R-\d+|CG-\d+|DG-\d+)\b/g;
  let match;
  const seen = new Set<string>();

  while ((match = violationRegex.exec(output)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      violations.push(match[1]);
    }
  }

  return violations;
}

// ─── MCP Tool Handler ─────────────────────────────────────────

export async function ritsu_dispatch_task(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const designSheetPath = params.design_sheet_path
    ? String(params.design_sheet_path)
    : undefined;
  const agentCount = Math.min(
    Math.max(Number(params.agents ?? 2), 1),
    8,
  );
  const crossReview = params.cross_review !== false;
  const traceId = params.trace_id ? String(params.trace_id) : undefined;

  // Find design-sheet
  const designSheet = designSheetPath
    ? readDesignSheet(designSheetPath)
    : findLatestDesignSheet(root);

  if (!designSheet) {
    return textResult(JSON.stringify({
      ok: false,
      error: "No design-sheet found. Run /r-think first.",
      agents: [],
      conflicts: [],
      unified_summary: "❌ No design-sheet found.",
    }));
  }

  // Run orchestration
  const result = await orchestrateMultiAgent(
    {
      projectRoot: root,
      designSheetPath: designSheet.path,
      agentCount,
      crossReview,
    },
    (prompt: string, label: string) => launchAndCollect(prompt, label, traceId),
  );

  return textResult(JSON.stringify({
    ok: result.all_quality_gates_passed && result.conflicts.length === 0,
    design_sheet: designSheet.path,
    contracts_found: designSheet.contracts.length,

    agents: result.agents.map((a) => ({
      agent_id: a.agent_id,
      contract_id: a.contract_id,
      ok: a.ok,
      quality_gates_passed: a.quality_gates_passed,
      modified_files: a.modified_files.length,
      violations: a.violations,
      duration_ms: a.duration_ms,
    })),

    cross_reviews: result.cross_reviews.map((r) => ({
      reviewer: r.reviewer_agent_id,
      target: r.target_agent_id,
      violations_found: r.violations_found.length,
      passed: r.passed,
    })),

    conflicts: result.conflicts,
    divergence_rate: result.divergence_rate,

    all_quality_gates_passed: result.all_quality_gates_passed,
    total_duration_ms: result.total_duration_ms,
    _unified_summary: result.unified_summary,
  }, null, 2));
}
