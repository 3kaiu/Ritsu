/**
 * Tests for multi-agent orchestration module.
 *
 * Tests focus on the pure logic in orchestration/multi-agent.ts:
 *   - Task analysis (splittable detection)
 *   - Sub-task building (contract grouping)
 *   - Prompt building
 *   - Cross-review prompt generation
 *   - Conflict detection
 *   - Result merging
 *
 * Agent launching is not tested here (requires claude binary).
 *
 * v8.2.0
 */

import { describe, it, expect } from "vitest";
import {
  analyzeTask,
  buildSubTasks,
  buildAgentPrompt,
  buildCrossReviewPrompts,
  detectConflicts,
  mergeResults,
  findLatestDesignSheet,
  extractTargetFiles,
  type DesignSheet,
  type AgentResult,
  type Contract,
} from "../orchestration/multi-agent.js";

import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

// ─── Fixtures ─────────────────────────────────────────────────

const singleContractSheet: DesignSheet = {
  path: ".ritsu/design-sheet-20260527-120000.md",
  content: `# Design Sheet

## 1. 任务识别 (Intake)
- 任务类型: 新功能
- 当前目标: Add user login API
- 风险等级: standard

## 2. 方案与边界 (Plan)
- 交付目标: Implement login with JWT
- 纳入范围: POST /auth/login endpoint
- 不纳入范围: OAuth integration

## 3. 技术契约 (Contract)
| Contract | Description | Test Hint |
| --- | --- | --- |
| C1 | POST /auth/login endpoint with JWT | tests/auth.test.ts |

## 4. 实施清单 (Execution)
- [ ] \`src/routes/auth.ts\`: Login route handler
`,
  contracts: [
    { id: "C1", description: "POST /auth/login endpoint with JWT", file_hint: "tests/auth.test.ts" },
  ],
};

const multiContractSheet: DesignSheet = {
  path: ".ritsu/design-sheet-20260527-130000.md",
  content: `# Design Sheet

## 1. 任务识别 (Intake)
- 任务类型: 新功能
- 当前目标: User dashboard with real-time orders
- 风险等级: critical

## 2. 方案与边界 (Plan)
- 交付目标: Implement user dashboard frontend + orders API backend
- 纳入范围: Dashboard UI, Orders API, WebSocket integration
- 不纳入范围: Payment processing

## 3. 技术契约 (Contract)
| Contract | Description | Test Hint |
| --- | --- | --- |
| C1 | User dashboard React component with real-time order list | components/Dashboard.test.tsx |
| C2 | GET /api/orders endpoint with pagination | tests/orders.test.ts |
| C3 | WebSocket connection for live order updates | tests/ws.test.ts |
| C4 | Order detail modal with cancellation | components/OrderDetail.test.tsx |

## 4. 实施清单 (Execution)
- [ ] \`ui/dashboard/Dashboard.tsx\`: Main dashboard component
- [ ] \`api/routes/orders.ts\`: Orders API route
- [ ] \`api/ws/orders.ts\`: WebSocket handler
- [ ] \`ui/dashboard/OrderDetail.tsx\`: Order detail modal
`,
  contracts: [
    { id: "C1", description: "User dashboard React component with real-time order list", file_hint: "components/Dashboard.test.tsx" },
    { id: "C2", description: "GET /api/orders endpoint with pagination", file_hint: "tests/orders.test.ts" },
    { id: "C3", description: "WebSocket connection for live order updates", file_hint: "tests/ws.test.ts" },
    { id: "C4", description: "Order detail modal with cancellation", file_hint: "components/OrderDetail.test.tsx" },
  ],
};

// ─── analyzeTask ─────────────────────────────────────────────

describe("analyzeTask", () => {
  it("should reject tasks with no contracts", () => {
    const empty: DesignSheet = { path: "", content: "", contracts: [] };
    const analysis = analyzeTask(empty);
    expect(analysis.splittable).toBe(false);
    expect(analysis.recommended_agents).toBe(1);
  });

  it("should reject single-contract tasks", () => {
    const analysis = analyzeTask(singleContractSheet);
    expect(analysis.splittable).toBe(false);
    expect(analysis.recommended_agents).toBe(1);
  });

  it("should suggest multi-agent for 3+ contracts", () => {
    const analysis = analyzeTask(multiContractSheet);
    expect(analysis.splittable).toBe(true);
    expect(analysis.recommended_agents).toBeGreaterThanOrEqual(2);
    expect(analysis.sub_tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("should detect multi-domain tasks", () => {
    const analysis = analyzeTask(multiContractSheet);
    expect(analysis.domain).toBe("multi");
  });
});

// ─── buildSubTasks ───────────────────────────────────────────

describe("buildSubTasks", () => {
  it("should return single task for agentCount 1", () => {
    const tasks = buildSubTasks(multiContractSheet, 1);
    expect(tasks.length).toBe(1);
    expect(tasks[0].contract.id).toBe("all");
  });

  it("should split contracts for multiple agents", () => {
    const tasks = buildSubTasks(multiContractSheet, 2);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // Each task should have a prompt
    for (const task of tasks) {
      expect(task.prompt.length).toBeGreaterThan(50);
    }
  });

  it("should filter target files by domain", () => {
    const tasks = buildSubTasks(multiContractSheet, 2);
    // Frontend agent should get UI files
    const frontendTask = tasks.find((t) => t.contract.id.includes("C1") || t.contract.id.includes("C4"));
    const backendTask = tasks.find((t) => t.contract.id.includes("C2") || t.contract.id.includes("C3"));

    // Both should have prompts
    expect(frontendTask).toBeDefined();
    expect(backendTask).toBeDefined();

    // Prompts should reference their specific contracts
    if (frontendTask) expect(frontendTask.prompt).toContain("Contracts");
    if (backendTask) expect(backendTask.prompt).toContain("Contracts");
  });
});

// ─── buildAgentPrompt ────────────────────────────────────────

describe("buildAgentPrompt", () => {
  it("should include contract details in prompt", () => {
    const contracts = [multiContractSheet.contracts[0]];
    const prompt = buildAgentPrompt(multiContractSheet, contracts, "frontend-agent");
    expect(prompt).toContain("frontend-agent");
    expect(prompt).toContain("C1");
    expect(prompt).toContain("User dashboard React component");
    expect(prompt).toContain("## Contracts to Implement");
    expect(prompt).toContain("## Shared Constraints");
    expect(prompt).toContain("## Deliverables");
  });

  it("should reference the design-sheet path", () => {
    const prompt = buildAgentPrompt(multiContractSheet, [multiContractSheet.contracts[0]], "test");
    expect(prompt).toContain(multiContractSheet.path);
  });

  it("should handle empty contracts gracefully", () => {
    const prompt = buildAgentPrompt(multiContractSheet, [], "empty");
    expect(prompt).toContain("Contracts to Implement");
  });
});

// ─── extractTargetFiles ──────────────────────────────────────

describe("extractTargetFiles", () => {
  it("should extract file paths from markdown content", () => {
    const files = extractTargetFiles(multiContractSheet.content);
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain("ui/dashboard/Dashboard.tsx");
    expect(files).toContain("api/routes/orders.ts");
  });

  it("should filter by domain", () => {
    const frontendFiles = extractTargetFiles(multiContractSheet.content, "frontend");
    expect(frontendFiles.length).toBeGreaterThanOrEqual(1);
    for (const f of frontendFiles) {
      expect(f.includes("ui/") || f.includes("components/") || f.includes("pages/")).toBe(true);
    }
  });
});

// ─── buildCrossReviewPrompts ─────────────────────────────────

describe("buildCrossReviewPrompts", () => {
  it("should return empty for single agent", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
    ];
    const reviews = buildCrossReviewPrompts(results);
    expect(reviews.length).toBe(0);
  });

  it("should pair agents for cross-review", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const reviews = buildCrossReviewPrompts(results);
    expect(reviews.length).toBe(2);
    expect(reviews[0].reviewer_agent_id).toBe("agent-1");
    expect(reviews[0].target_agent_id).toBe("agent-2");
    expect(reviews[1].reviewer_agent_id).toBe("agent-2");
    expect(reviews[1].target_agent_id).toBe("agent-1");
  });

  it("should include modified files in review prompt", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["frontend/page.tsx"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["backend/api.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const reviews = buildCrossReviewPrompts(results);
    // reviewer agent-1 targets agent-2 → should contain agent-2's files
    expect(reviews[0].prompt).toContain("backend/api.ts");
    // reviewer agent-2 targets agent-1 → should contain agent-1's files
    expect(reviews[1].prompt).toContain("frontend/page.tsx");
  });
});

// ─── detectConflicts ─────────────────────────────────────────

describe("detectConflicts", () => {
  it("should return empty for single agent", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts.length).toBe(0);
  });

  it("should detect file collisions", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["shared/types.ts", "feature-a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["shared/types.ts", "feature-b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const fileCollision = conflicts.find((c) => c.type === "file_collision");
    expect(fileCollision).toBeDefined();
    expect(fileCollision!.files).toContain("shared/types.ts");
  });

  it("should detect quality divergence", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: false, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    const qualityConflict = conflicts.find((c) => c.type === "quality_divergence");
    expect(qualityConflict).toBeDefined();
    expect(qualityConflict!.severity).toBe("hard_stop");
  });

  it("should not flag quality divergence when both pass", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    const qualityConflict = conflicts.find((c) => c.type === "quality_divergence");
    expect(qualityConflict).toBeUndefined();
  });

  it("should handle no conflicts gracefully", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts.length).toBe(0);
  });
});

// ─── mergeResults ────────────────────────────────────────────

describe("mergeResults", () => {
  it("should produce a unified summary", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [".ritsu/dev-report-agent-1.md"], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [".ritsu/dev-report-agent-2.md"], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const merged = mergeResults(results, []);
    expect(merged.unified_summary).toContain("Multi-Agent Delivery Report");
    expect(merged.unified_summary).toContain("agent-1");
    expect(merged.unified_summary).toContain("agent-2");
    expect(merged.unified_summary).toContain(".ritsu/dev-report-agent-1.md");
    expect(merged.all_quality_gates_passed).toBe(true);
    expect(merged.total_duration_ms).toBe(3000);
  });

  it("should report quality failures", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: false, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    const merged = mergeResults(results, conflicts);
    expect(merged.all_quality_gates_passed).toBe(false);
  });

  it("should calculate divergence rate", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["shared.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["shared.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const conflicts = detectConflicts(results);
    const merged = mergeResults(results, conflicts);
    expect(merged.divergence_rate).toBeGreaterThan(0);
  });

  it("should return 0 divergence for clean results", () => {
    const results: AgentResult[] = [
      { agent_id: "agent-1", sub_task_id: "t1", contract_id: "C1", ok: true, output: "", artifacts: [], modified_files: ["a.ts"], violations: [], quality_gates_passed: true, duration_ms: 1000 },
      { agent_id: "agent-2", sub_task_id: "t2", contract_id: "C2", ok: true, output: "", artifacts: [], modified_files: ["b.ts"], violations: [], quality_gates_passed: true, duration_ms: 2000 },
    ];
    const merged = mergeResults(results, []);
    expect(merged.divergence_rate).toBe(0);
  });
});
