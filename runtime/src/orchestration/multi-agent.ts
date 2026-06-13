/**
 * Multi-Agent Orchestration Engine
 *
 * Core orchestration logic for splitting work across multiple AI coding agents,
 * cross-reviewing their outputs, and detecting conflicts.
 *
 * The orchestrator does NOT directly launch agents — it constructs the prompts
 * and dispatch plans. Launch happens through the ritsu_launch_agent MCP tool.
 *
 * Architecture:
 *   1. analyzeTask(designSheet) → determine if multi-agent is beneficial
 *   2. buildDispatchPlan(task, agentCount) → split contracts into sub-tasks
 *   3. crossReview(agentResults) → agents review each other's code
 *   4. detectConflicts(agentResults) → find divergent outputs
 *   5. mergeResults(agentResults, conflicts) → unified summary
 *
 * v8.2.0
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "fast-glob";

// ─── Design Analysis Type (from fe-sight) ─────────────────────

export interface DesignTokenValue {
  name: string;
  value: string;
}

export interface TypographyTokenValue {
  name: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number;
}

export interface DesignAnalysisData {
  layout?: string;        // Human-readable layout structure description
  colors?: DesignTokenValue[];
  typography?: TypographyTokenValue[];
  spacing?: DesignTokenValue[];
  shadows?: DesignTokenValue[];
  borderRadius?: DesignTokenValue[];
  styleSystem?: string;
}

// ─── Types ────────────────────────────────────────────────────

export interface Contract {
  id: string; // "C1", "C2", "OS-xxx"
  description: string;
  file_hint: string; // suggested test file or implementation file
}

export interface SubTask {
  contract: Contract;
  prompt: string; // the prompt to give the agent
  target_files: string[]; // files this agent should work on
  dependencies: string[]; // sub-task IDs that must complete first
}

export interface AgentResult {
  agent_id: string;
  sub_task_id: string;
  contract_id: string;
  ok: boolean;
  output: string;
  artifacts: string[]; // paths to artifacts written
  modified_files: string[]; // files changed by this agent
  violations: string[]; // policy violations found
  quality_gates_passed: boolean;
  duration_ms: number;
}

export interface CrossReview {
  reviewer_agent_id: string;
  target_agent_id: string;
  target_contract_id: string;
  violations_found: string[];
  issues: string[];
  passed: boolean;
}

export interface Conflict {
  type: "file_collision" | "contract_violation" | "quality_divergence" | "design_divergence";
  description: string;
  agents: string[];
  files?: string[];
  severity: "warn" | "error" | "hard_stop";
}

export interface UnifiedResult {
  agents: AgentResult[];
  cross_reviews: CrossReview[];
  conflicts: Conflict[];
  divergence_rate: number; // 0-1: fraction of agents with conflicting outputs
  unified_summary: string;
  all_quality_gates_passed: boolean;
  total_duration_ms: number;
}

export interface DesignSheet {
  path: string;
  content: string;
  contracts: Contract[];
}

// ─── Design-Sheet Parsing ─────────────────────────────────────

/**
 * Find and parse the latest design-sheet from .ritsu/.
 */
export function findLatestDesignSheet(projectRoot: string): DesignSheet | null {
  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) return null;

  const files = globSync("design-sheet-*.md", {
    cwd: ritsuDir,
    absolute: true,
  }).sort().reverse();

  if (files.length === 0) return null;

  const path = files[0];
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return null;
  }

  // Extract contracts from markdown table
  // Format: | C1 | {description} | {test_file_hint} |
  const contractRegex = /\|\s*(C\d+|OS-\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
  const contracts: Contract[] = [];
  for (const match of content.matchAll(contractRegex)) {
    contracts.push({
      id: match[1].trim(),
      description: match[2].trim(),
      file_hint: match[3].trim(),
    });
  }

  return { path, content, contracts };
}

/**
 * Read specific design-sheet by path.
 */
export function readDesignSheet(path: string): DesignSheet | null {
  if (!existsSync(path)) return null;
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return null;
  }

  const contractRegex = /\|\s*(C\d+|OS-\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
  const contracts: Contract[] = [];
  for (const match of content.matchAll(contractRegex)) {
    contracts.push({
      id: match[1].trim(),
      description: match[2].trim(),
      file_hint: match[3].trim(),
    });
  }

  return { path, content, contracts };
}

// ─── Task Analysis ────────────────────────────────────────────

export interface TaskAnalysis {
  splittable: boolean;
  reason: string;
  recommended_agents: number;
  sub_tasks: SubTask[];
  domain: "single" | "multi";
  contract_count: number;
}

/**
 * Analyze a design-sheet to determine if the task benefits from multi-agent dispatch.
 *
 * Multi-agent candidates:
 *   - 3+ independent contracts → high parallelism potential
 *   - Contracts spanning multiple domains (frontend + backend) → natural split
 *   - Total estimated effort high → parallel reduces wall-clock time
 *
 * Single-agent candidates (use existing /r-dev path):
 *   - 1-2 contracts → too small to split
 *   - Contracts with tight file coupling → splitting would cause conflicts
 *   - Simple refactors → overhead of coordination exceeds benefit
 */
export function analyzeTask(designSheet: DesignSheet, designAnalysis?: DesignAnalysisData): TaskAnalysis {
  const contracts = designSheet.contracts;
  const count = contracts.length;

  if (count === 0) {
    return {
      splittable: false,
      reason: "No contracts found in design-sheet — nothing to dispatch",
      recommended_agents: 1,
      sub_tasks: [],
      domain: "single",
      contract_count: 0,
    };
  }

  // Detect domain span from content keywords
  const content = designSheet.content.toLowerCase();
  const hasFrontend = /frontend|react|vue|component|ui\//.test(content);
  const hasBackend = /backend|api|database|route|controller|model/.test(content);
  const multiDomain = hasFrontend && hasBackend;

  if (count >= 3 || (count >= 2 && multiDomain)) {
    // Splittable: build sub-tasks
    const subTasks = buildSubTasks(designSheet, Math.min(count, 4), designAnalysis);
    const agentCount = Math.min(subTasks.length, 4);

    return {
      splittable: true,
      reason: multiDomain
        ? `Detected ${count} contracts spanning multiple domains — natural split`
        : `${count} independent contracts found — parallel dispatch beneficial`,
      recommended_agents: agentCount,
      sub_tasks: subTasks.slice(0, agentCount),
      domain: multiDomain ? "multi" : "single",
      contract_count: count,
    };
  }

  return {
    splittable: false,
    reason: count <= 1
      ? `Only 1 contract — single agent is most efficient`
      : `2 contracts — overhead of coordination exceeds benefit unless multi-domain`,
    recommended_agents: 1,
    sub_tasks: [],
    domain: "single",
    contract_count: count,
  };
}

// ─── Sub-Task Building ───────────────────────────────────────

/**
 * Build sub-tasks from a design-sheet, grouping contracts into agent-sized chunks.
 *
 * Strategy:
 *   - If multi-domain: group frontend contracts together, backend contracts together
 *   - If single-domain: distribute contracts round-robin across agents
 *   - Each sub-task gets: contract details, relevant file hints, shared context
 */
export function buildSubTasks(
  designSheet: DesignSheet,
  agentCount: number,
  designAnalysis?: DesignAnalysisData,
): SubTask[] {
  const contracts = designSheet.contracts;
  if (contracts.length === 0) return [];
  if (agentCount <= 1) {
    // Single agent gets everything
    return [{
      contract: { id: "all", description: "Full task", file_hint: "" },
      prompt: buildAgentPrompt(designSheet, contracts, "all", designAnalysis),
      target_files: extractTargetFiles(designSheet.content),
      dependencies: [],
    }];
  }

  // Try domain-aware grouping first
  const content = designSheet.content.toLowerCase();

  interface Grouped {
    domain: string;
    contracts: Contract[];
  }

  const groups: Grouped[] = [];

  if (/frontend|react|vue|component|ui\//.test(content)) {
    groups.push({
      domain: "frontend",
      contracts: contracts.filter((c) =>
        /ui|component|frontend|view|page/.test(c.description.toLowerCase()),
      ),
    });
  }

  if (/backend|api|database|route|model/.test(content)) {
    groups.push({
      domain: "backend",
      contracts: contracts.filter((c) =>
        /api|route|database|model|backend|service/.test(c.description.toLowerCase()),
      ),
    });
  }

  if (groups.length >= 2) {
    // Multi-domain: assign unassigned contracts to the largest group
    const assigned = new Set(groups.flatMap((g) => g.contracts.map((c) => c.id)));
    const unassigned = contracts.filter((c) => !assigned.has(c.id));

    if (unassigned.length > 0) {
      // Add to the group with fewer contracts
      const target = groups.reduce((a, b) =>
        a.contracts.length <= b.contracts.length ? a : b,
      );
      target.contracts.push(...unassigned);
    }

    // Only use groups that have contracts
    const activeGroups = groups.filter((g) => g.contracts.length > 0);

    return activeGroups.map((g) => ({
      contract: {
        id: g.contracts.map((c) => c.id).join("+"),
        description: `${g.domain}: ${g.contracts.map((c) => c.id).join(", ")}`,
        file_hint: g.contracts.map((c) => c.file_hint).filter(Boolean).join(", "),
      },
      prompt: buildAgentPrompt(designSheet, g.contracts, g.domain, designAnalysis),
      target_files: extractTargetFiles(designSheet.content, g.domain),
      dependencies: [],
    }));
  }

  // Single-domain: distribute round-robin
  const subTasks: SubTask[] = [];
  const perAgent = Math.ceil(contracts.length / agentCount);

  for (let i = 0; i < agentCount; i++) {
    const start = i * perAgent;
    const end = Math.min(start + perAgent, contracts.length);
    const slice = contracts.slice(start, end);
    if (slice.length === 0) continue;

    const ids = slice.map((c) => c.id);
    subTasks.push({
      contract: {
        id: ids.join("+"),
        description: `Contracts ${ids.join(", ")}`,
        file_hint: slice.map((c) => c.file_hint).filter(Boolean).join(", "),
      },
      prompt: buildAgentPrompt(designSheet, slice, `agent-${i + 1}`, designAnalysis),
      target_files: extractTargetFiles(designSheet.content),
      dependencies: [],
    });
  }

  return subTasks;
}

// ─── Prompt Building ─────────────────────────────────────────

/**
 * Build a focused prompt for an agent given a subset of contracts.
 *
 * Each agent gets:
 *   1. The overall task goal (from design-sheet)
 *   2. Their specific contracts (not the full list — reduces noise)
 *   3. The in-scope files relevant to their contracts
 *   4. The shared context (coding style, project structure)
 *   5. Instruction to write tests and run quality gates
 */
export function buildAgentPrompt(
  designSheet: DesignSheet,
  contracts: Contract[],
  agentLabel: string,
  designAnalysis?: DesignAnalysisData,
): string {
  const intakeMatch = designSheet.content.match(/## 1\. 任务识别.*?(?=## 2\.|$)/s);
  const planMatch = designSheet.content.match(/## 2\. 方案与边界.*?(?=## 3\.|$)/s);
  const goal = intakeMatch?.[0]?.split("\n")
    .find((l) => l.includes("当前目标"))
    ?.replace(/-.*?:/, "").trim() ?? "Implement design";

  const inScope = planMatch?.[0]?.split("\n")
    .filter((l) => l.includes("纳入范围"))
    .map((l) => l.replace(/-.*?:/, "").trim())
    .filter(Boolean)
    .join("; ") ?? "";

  const contractLines = contracts.map((c) =>
    `- ${c.id}: ${c.description}${c.file_hint ? ` (→ ${c.file_hint})` : ""}`,
  ).join("\n");

  const targetFiles = extractTargetFiles(designSheet.content).join(", ");

  // Build visual design spec section if analysis data is available
  const designSpecLines: string[] = [];
  if (designAnalysis) {
    designSpecLines.push(``, `## Visual Design Spec`, ``);

    if (designAnalysis.layout) {
      designSpecLines.push(`### Layout Structure`);
      designSpecLines.push(designAnalysis.layout);
      designSpecLines.push(``);
    }

    if (designAnalysis.colors && designAnalysis.colors.length > 0) {
      designSpecLines.push(`### Color Palette`);
      for (const c of designAnalysis.colors) {
        designSpecLines.push(`- \`${c.name}\`: ${c.value}`);
      }
      designSpecLines.push(``);
    }

    if (designAnalysis.typography && designAnalysis.typography.length > 0) {
      designSpecLines.push(`### Typography`);
      for (const t of designAnalysis.typography) {
        designSpecLines.push(`- ${t.name}: ${t.fontSize}px/${t.lineHeight} ${t.fontWeight}w ${t.fontFamily}`);
      }
      designSpecLines.push(``);
    }

    if (designAnalysis.spacing && designAnalysis.spacing.length > 0) {
      designSpecLines.push(`### Spacing`);
      for (const s of designAnalysis.spacing) {
        designSpecLines.push(`- ${s.name}: ${s.value}`);
      }
      designSpecLines.push(``);
    }

    if (designAnalysis.styleSystem) {
      designSpecLines.push(`Style system: ${designAnalysis.styleSystem}`);
      designSpecLines.push(``);
    }

    designSpecLines.push(`**Important**: Follow these design tokens exactly. Do not invent colors, font sizes, or spacing values.`);
  }

  return [
    `# Task: ${agentLabel}`,
    ``,
    `## Goal`,
    goal ? `${goal}` : "Implement the assigned contracts.",
    inScope ? `Scope: ${inScope}` : "",
    ``,
    `## Contracts to Implement`,
    contractLines,
    ``,
    `## Context`,
    `- Read the full design-sheet at \`${designSheet.path}\` for complete context.`,
    targetFiles ? `- Working files: ${targetFiles}` : "",
    `- Use the project's existing coding style and conventions.`,
    `- Run quality gates after implementation.`,
    `- Write tests for all new code.`,
    ``,
    ...designSpecLines,
    ``,
    `## Shared Constraints (must be followed by all agents)`,
    `- Do not modify files outside your assigned contracts.`,
    `- If you discover design issues, flag them — don't silently work around them.`,
    `- All code must pass lint and existing tests.`,
    `- Do not introduce new dependencies without explicit approval.`,
    ``,
    `## Deliverables`,
    `1. Working code for all assigned contracts`,
    `2. Tests covering the new code`,
    `3. Quality gates must pass (run \`ritsu_run_quality_gates\` or your test framework)`,
    `4. Report any contract conflicts or design gaps you discover`,
  ].filter(Boolean).join("\n");
}

// ─── File Analysis ───────────────────────────────────────────

/**
 * Extract target files from design-sheet content.
 * Optionally filtered by domain keyword.
 */
export function extractTargetFiles(
  content: string,
  domain?: string,
): string[] {
  const files: string[] = [];

  // Match file paths in markdown code blocks and list items
  const fileRegex = /`([^`]+\.(?:ts|tsx|js|jsx|py|go|rs|vue|css|scss|json))`/g;
  for (const match of content.matchAll(fileRegex)) {
    const file = match[1];
    if (!files.includes(file)) {
      // Domain filter
      if (domain === "frontend" && !/ui\/|frontend\/|components\/|pages\/|views\//.test(file)) continue;
      if (domain === "backend" && !/api\/|routes\/|controllers\/|models\/|services\/|backend\//.test(file)) continue;
      files.push(file);
    }
  }

  return files;
}

// ─── Cross-Review ────────────────────────────────────────────

/**
 * Build review prompts for cross-review between agents.
 *
 * Agent A reviews Agent B's code and vice versa.
 * Each review focuses on contract compliance, not code style.
 */
export function buildCrossReviewPrompts(
  agentResults: AgentResult[],
): Array<{ reviewer_agent_id: string; target_agent_id: string; prompt: string }> {
  const reviews: Array<{ reviewer_agent_id: string; target_agent_id: string; prompt: string }> = [];

  if (agentResults.length < 2) return reviews;

  // Pair agents for cross-review (A→B, B→A, C→A, etc.)
  for (let i = 0; i < agentResults.length; i++) {
    const reviewer = agentResults[i];
    const target = agentResults[(i + 1) % agentResults.length];
    if (reviewer.agent_id === target.agent_id) continue;

    const prompt = [
      `# Cross-Review: ${reviewer.agent_id} → ${target.agent_id}`,
      ``,
      `You are reviewing code written by another AI agent.`,
      `The code implements contract: ${target.contract_id}`,
      ``,
      `## Review Focus (strictly these questions)`,
      `1. Does the implementation satisfy the contract requirements?`,
      `2. Are there any security issues? (SQL injection, XSS, hardcoded secrets)`,
      `3. Are there any integration issues with code outside the contract boundary?`,
      `4. Are error paths handled properly?`,
      ``,
      `## Files Modified by ${target.agent_id}`,
      target.modified_files.map((f) => `- \`${f}\``).join("\n"),
      ``,
      `## Output Format`,
      `List specific issues as a JSON array:`,
      `[`,
      `  {"severity": "error", "file": "path/to/file.ts", "description": "issue description"}`,
      `]`,
      `Return empty array [] if no issues found.`,
    ].join("\n");

    reviews.push({
      reviewer_agent_id: reviewer.agent_id,
      target_agent_id: target.agent_id,
      prompt,
    });
  }

  return reviews;
}

// ─── Conflict Detection ───────────────────────────────────────

/**
 * Detect conflicts between agent outputs.
 *
 * Conflict types:
 *   - file_collision: same file modified by multiple agents (non-mergeable)
 *   - contract_violation: one agent's code violates another's contract
 *   - quality_divergence: agents report different quality gate results
 *   - design_divergence: agents interpreted the design differently
 */
export function detectConflicts(
  agentResults: AgentResult[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  if (agentResults.length < 2) return conflicts;

  // 1. File collision detection
  const fileMap = new Map<string, string[]>(); // file → agent_ids
  for (const result of agentResults) {
    for (const file of result.modified_files) {
      const existing = fileMap.get(file) ?? [];
      existing.push(result.agent_id);
      fileMap.set(file, existing);
    }
  }

  for (const [file, agents] of fileMap.entries()) {
    if (agents.length > 1) {
      conflicts.push({
        type: "file_collision",
        description: `File \`${file}\` modified by multiple agents: ${agents.join(", ")}`,
        agents,
        files: [file],
        severity: "error",
      });
    }
  }

  // 2. Quality divergence detection
  const validResults = agentResults.filter((r) => r.ok);
  if (validResults.length >= 2) {
    const allPassed = validResults.every((r) => r.quality_gates_passed);
    const anyFailed = validResults.some((r) => !r.quality_gates_passed);

    if (!allPassed && anyFailed) {
      const failedAgents = validResults.filter((r) => !r.quality_gates_passed);
      const passedAgents = validResults.filter((r) => r.quality_gates_passed);
      conflicts.push({
        type: "quality_divergence",
        description: `Quality gates: ${passedAgents.map((a) => a.agent_id).join(", ")} passed, ${failedAgents.map((a) => a.agent_id).join(", ")} failed`,
        agents: [passedAgents[0]?.agent_id ?? "", failedAgents[0]?.agent_id ?? ""].filter(Boolean),
        severity: "hard_stop",
      });
    }
  }

  // 3. Check for agents that reported violations in shared areas
  const violationAgents = agentResults.filter((r) => r.violations.length > 0);
  if (violationAgents.length >= 2) {
    const sharedViolations = violationAgents
      .flatMap((r) => r.violations)
      .filter((v) =>
        violationAgents.every((a) =>
          a.agent_id === violationAgents[0].agent_id || a.violations.includes(v),
        ),
      );

    if (sharedViolations.length > 0) {
      conflicts.push({
        type: "design_divergence",
        description: `Shared violations found across agents: ${sharedViolations.join(", ")}`,
        agents: violationAgents.map((a) => a.agent_id),
        severity: "warn",
      });
    }
  }

  return conflicts;
}

// ─── Result Merging ──────────────────────────────────────────

/**
 * Merge agent results into a unified summary.
 */
export function mergeResults(
  agentResults: AgentResult[],
  conflicts: Conflict[],
): UnifiedResult {
  const totalDuration = agentResults.reduce((sum, r) => sum + r.duration_ms, 0);

  // Build unified summary
  const summaryParts: string[] = [];
  summaryParts.push(`# Multi-Agent Delivery Report`);
  summaryParts.push(``);
  summaryParts.push(`## Agents`);
  for (const r of agentResults) {
    const status = r.ok ? (r.quality_gates_passed ? "✅" : "⚠️") : "❌";
    summaryParts.push(`- ${status} ${r.agent_id} (${r.contract_id}): ${r.ok ? `${r.modified_files.length} files` : "failed"} | ${r.duration_ms}ms`);
  }
  summaryParts.push(``);

  if (conflicts.length > 0) {
    summaryParts.push(`## Conflicts (${conflicts.length})`);
    for (const c of conflicts) {
      const icon = c.severity === "hard_stop" ? "🔴" : c.severity === "error" ? "🟡" : "🟢";
      summaryParts.push(`- ${icon} [${c.type}] ${c.description}`);
    }
    summaryParts.push(``);
  }

  summaryParts.push(`## Quality Gates`);
  const allPassed = agentResults.every((r) => r.quality_gates_passed);
  summaryParts.push(allPassed ? "✅ All agents passed quality gates" : "❌ Some agents failed quality gates");
  summaryParts.push(``);
  summaryParts.push(`## Artifacts`);
  for (const r of agentResults) {
    if (r.artifacts.length > 0) {
      for (const a of r.artifacts) {
        summaryParts.push(`- \`${a}\` (${r.agent_id})`);
      }
    }
  }

  const allQualityPassed = agentResults.every((r) => r.quality_gates_passed);
  const hardStopConflicts = conflicts.filter((c) => c.severity === "hard_stop");
  const hasFileCollisions = conflicts.some((c) => c.type === "file_collision");

  // Divergence rate: fraction of agents with conflicts or quality failures
  const agentsWithIssues = new Set<string>();
  for (const c of conflicts) {
    for (const a of c.agents) agentsWithIssues.add(a);
  }
  for (const r of agentResults) {
    if (!r.quality_gates_passed) agentsWithIssues.add(r.agent_id);
  }
  const divergenceRate = agentResults.length > 0
    ? agentsWithIssues.size / agentResults.length
    : 0;

  return {
    agents: agentResults,
    cross_reviews: [],
    conflicts,
    divergence_rate: Math.round(divergenceRate * 100) / 100,
    unified_summary: summaryParts.join("\n"),
    all_quality_gates_passed: allQualityPassed && hardStopConflicts.length === 0 && !hasFileCollisions,
    total_duration_ms: totalDuration,
  };
}

// ─── Orchestrator Entry Point ─────────────────────────────────

export interface DispatchOptions {
  projectRoot: string;
  designSheetPath?: string;
  agentCount?: number;
  contracts?: string[];
  crossReview?: boolean;
  timeoutMs?: number;
  /** Structured design analysis from fe-sight (layout intents, tokens, etc.) */
  designAnalysis?: DesignAnalysisData;
}

/**
 * Full orchestration pipeline.
 * This is the entry point called by the ritsu_dispatch_task MCP tool.
 *
 * Steps:
 *   1. Load design-sheet
 *   2. Analyze task
 *   3. Build sub-tasks and dispatch prompts
 *   4. Launch agents in parallel
 *   5. Run cross-review
 *   6. Detect conflicts
 *   7. Merge results
 */
export async function orchestrateMultiAgent(
  options: DispatchOptions,
  launchFn: (prompt: string, label: string) => Promise<AgentResult>,
): Promise<UnifiedResult> {
  const { projectRoot, designSheetPath, agentCount = 2, crossReview = true, designAnalysis } = options;

  // Load design-sheet
  const designSheet = designSheetPath
    ? readDesignSheet(designSheetPath)
    : findLatestDesignSheet(projectRoot);

  if (!designSheet) {
    return {
      agents: [],
      cross_reviews: [],
      conflicts: [],
      divergence_rate: 0,
      unified_summary: "❌ No design-sheet found. Run /r-think first.",
      all_quality_gates_passed: false,
      total_duration_ms: 0,
    };
  }

  const analysis = analyzeTask(designSheet, designAnalysis);
  const shouldSplit = analysis.splittable && agentCount > 1;
  const targetAgentCount = shouldSplit ? Math.min(agentCount, analysis.recommended_agents) : 1;

  console.error(`[ritsu-orchestrator] Task auto-judgment: splittable=${analysis.splittable}, recommended_agents=${analysis.recommended_agents}, requestedAgentCount=${agentCount}. Routing to ${shouldSplit ? "MULTI-AGENT" : "SINGLE-AGENT"} path with targetAgentCount=${targetAgentCount}.`);

  const subTasks = shouldSplit
    ? analysis.sub_tasks.slice(0, targetAgentCount)
    : buildSubTasks(designSheet, 1, designAnalysis);

  // Launch agents in parallel
  const agentResults = await Promise.all(
    subTasks.map((task, i) =>
      launchFn(
        task.prompt,
        shouldSplit ? `agent-${i + 1}(${task.contract.id})` : `agent-single(all)`
      )
    ),
  );

  // Cross-review
  let crossReviews: CrossReview[] = [];
  if (crossReview && shouldSplit && agentResults.length >= 2) {
    const reviewPrompts = buildCrossReviewPrompts(agentResults);
    const reviewResults = await Promise.all(
      reviewPrompts.map(async (rp) => {
        const result = await launchFn(rp.prompt, `review-${rp.target_agent_id}`);
        return {
          reviewer_agent_id: rp.reviewer_agent_id,
          target_agent_id: rp.target_agent_id,
          target_contract_id: agentResults.find((a) => a.agent_id === rp.target_agent_id)?.contract_id ?? "",
          violations_found: result.violations,
          issues: [],
          passed: result.ok,
        } satisfies CrossReview;
      }),
    );
    crossReviews = reviewResults;
  }

  // Conflict detection
  const conflicts = detectConflicts(agentResults);

  // Merge
  const merged = mergeResults(agentResults, conflicts);
  merged.cross_reviews = crossReviews;

  // Add auto-routing notice to unified summary
  const routingNotice = [
    `> [!NOTE]`,
    `> **Multi-Agent Auto-Judgment Routing**: Task splittability is **${analysis.splittable}** (reason: ${analysis.reason}).`,
    `> Automatically routed to **${shouldSplit ? "Parallel Multi-Agent" : "Single Agent Fallback"}** execution with **${targetAgentCount}** agent(s).`,
    ``,
  ].join("\n");
  merged.unified_summary = routingNotice + merged.unified_summary;

  return merged;
}
