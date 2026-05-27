/**
 * Demo Data Generator
 *
 * Generates sample Ritsu data for `ritsu bootstrap --demo`.
 * Creates a realistic project scenario so new users can immediately
 * run commands like `ritsu violations` and `ritsu report`.
 *
 * v8.6.0
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Generate demo data in the project's .ritsu/ directory.
 */
export function generateDemoData(projectRoot: string): string[] {
  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });

  const files: string[] = [];

  // ─── Design Sheet ─────────────────────────────────────────
  const designSheet = `# Design Sheet (设计单)

## 1. 任务识别 (Intake)
- 任务类型: 新功能
- 当前目标: Add user dashboard with order history
- 风险等级: critical

## 2. 方案与边界 (Plan)
- 交付目标: Implement user dashboard frontend with order list API
- 纳入范围: Dashboard UI, Orders API, unit tests
- 不纳入范围: Payment processing, admin panel

## 3. 技术契约 (Contract)
| Contract | Description | Test Hint |
| --- | --- | --- |
| C1 | User dashboard React component with order table | components/Dashboard.test.tsx |
| C2 | GET /api/orders endpoint with pagination | tests/orders.test.ts |
| C3 | Order detail modal with cancel action | components/OrderDetail.test.tsx |

## 4. 决策理由 (Decision Rationale)
- 关键决策: Use React 19 + TanStack Query for data fetching
- 被拒绝方案: Redux — overkill for this scope

## 5. 代价与风险 (Metrics & Risks)
- 复杂度评分: 5
- 架构侵入度: 3
- 回滚步骤: git revert HEAD && migrate down

## 6. 实施清单 (Execution)
- [ ] \`ui/dashboard/Dashboard.tsx\`: Main dashboard component
- [ ] \`api/routes/orders.ts\`: Orders API with pagination
- [ ] \`ui/dashboard/OrderDetail.tsx\`: Order detail modal
`;

  const dsFile = resolve(ritsuDir, "design-sheet-20260527-demo.md");
  writeFileSync(dsFile, designSheet, "utf-8");
  files.push(dsFile);

  // ─── Ctx Events ──────────────────────────────────────────
  const ctxFile = resolve(ritsuDir, "ctx-2026-05.jsonl");
  const events = [
    { ts: "20260527-100000", correlation_id: "cid-demo-1", trace_id: "trace-demo-1", span_id: "span-demo-1", status: "started", skill: "think", domain: "fullstack", step: "step-1" },
    { ts: "20260527-100500", correlation_id: "cid-demo-1", trace_id: "trace-demo-1", span_id: "span-demo-1", status: "done", skill: "think", domain: "fullstack", step: "step-1" },
    { ts: "20260527-101000", correlation_id: "cid-demo-2", trace_id: "trace-demo-2", span_id: "span-demo-2", status: "started", skill: "dev", domain: "fullstack", step: "step-1", cost: { tokens_in: 1500, tokens_out: 3200, model: "claude-sonnet-4-6", duration_ms: 45000 } },
    { ts: "20260527-102000", correlation_id: "cid-demo-2", trace_id: "trace-demo-2", span_id: "span-demo-2", status: "violation_detected", skill: "dev", domain: "fullstack", violation: { rule_id: "AP-4", severity: "fatal", evidence: "ui/dashboard/Dashboard.tsx — added unrelated admin feature", blocked: true } },
    { ts: "20260527-102500", correlation_id: "cid-demo-2", trace_id: "trace-demo-2", span_id: "span-demo-2", status: "done", skill: "dev", domain: "fullstack", step: "step-3", cost: { tokens_in: 4500, tokens_out: 8900, model: "claude-sonnet-4-6", duration_ms: 120000 } },
    { ts: "20260527-103000", correlation_id: "cid-demo-3", trace_id: "trace-demo-3", span_id: "span-demo-3", status: "started", skill: "review", domain: "fullstack", step: "step-1" },
    { ts: "20260527-103500", correlation_id: "cid-demo-3", trace_id: "trace-demo-3", span_id: "span-demo-3", status: "done", skill: "review", domain: "fullstack", step: "step-1", cost: { tokens_in: 800, tokens_out: 1500, model: "claude-haiku-4-5", duration_ms: 15000 } },
  ];

  for (const event of events) {
    appendFileSync(ctxFile, JSON.stringify(event) + "\n", "utf-8");
  }
  files.push(ctxFile);

  // ─── Contracts ───────────────────────────────────────────
  const contracts = {
    version: 1,
    updated_at: new Date().toISOString(),
    contracts: [
      { id: "C1", description: "User dashboard React component with order table", test_file_hint: "components/Dashboard.test.tsx", domain: "frontend", status: "verified", evidence: "components/Dashboard.test.tsx:15", design_sheet: "design-sheet-20260527-demo.md", created_at: new Date().toISOString() },
      { id: "C2", description: "GET /api/orders endpoint with pagination", test_file_hint: "tests/orders.test.ts", domain: "backend", status: "pending", evidence: "", design_sheet: "design-sheet-20260527-demo.md", created_at: new Date().toISOString() },
      { id: "C3", description: "Order detail modal with cancel action", test_file_hint: "components/OrderDetail.test.tsx", domain: "frontend", status: "pending", evidence: "", design_sheet: "design-sheet-20260527-demo.md", created_at: new Date().toISOString() },
    ],
    design_sheets_index: ["design-sheet-20260527-demo.md"],
  };
  writeFileSync(resolve(ritsuDir, "contracts.json"), JSON.stringify(contracts, null, 2), "utf-8");
  files.push(resolve(ritsuDir, "contracts.json"));

  // ─── Violations ──────────────────────────────────────────
  const violations = {
    version: 1,
    updated_at: new Date().toISOString(),
    violations: [
      {
        id: "v-demo-001",
        rule_id: "AP-4",
        severity: "fatal",
        message: "Scope creep detected: added admin feature outside contract boundary",
        file: "ui/dashboard/Dashboard.tsx",
        trace_id: "trace-demo-2",
        skill: "dev",
        status: "open",
        evidence: "ui/dashboard/Dashboard.tsx:42 — unrelated admin panel code",
        created_at: "2026-05-27T10:20:00.000Z",
        updated_at: "2026-05-27T10:20:00.000Z",
        commit_sha: "abc1234",
      },
      {
        id: "v-demo-002",
        rule_id: "R-3",
        severity: "hard_stop",
        message: "Hardcoded API key in configuration",
        file: "src/config.ts",
        trace_id: "trace-demo-2",
        skill: "dev",
        status: "open",
        evidence: "src/config.ts:12 — api_key = 'sk-...'",
        created_at: "2026-05-27T10:25:00.000Z",
        updated_at: "2026-05-27T10:25:00.000Z",
        commit_sha: "abc1234",
      },
    ],
  };
  writeFileSync(resolve(ritsuDir, "violations.json"), JSON.stringify(violations, null, 2), "utf-8");
  files.push(resolve(ritsuDir, "violations.json"));

  // ─── Quality Gate Snapshot ───────────────────────────────
  const qualityGate = {
    recorded_at: new Date().toISOString(),
    passed: true,
    status: "passed",
    lint: { status: "passed", output: "All lint checks passed" },
    test: { status: "passed", failures: [], output: "Tests: 42 passed, 0 failed" },
    coverage: {
      summary: { lines: { total: 320, covered: 275, skipped: 0, pct: 85.94 }, statements: { total: 350, covered: 290, skipped: 0, pct: 82.86 }, functions: { total: 45, covered: 42, skipped: 0, pct: 93.33 }, branches: { total: 120, covered: 88, skipped: 0, pct: 73.33 } },
      per_file: { "ui/dashboard/Dashboard.tsx": { lines: { total: 80, covered: 72, skipped: 0, pct: 90 }, statements: { total: 95, covered: 84, skipped: 0, pct: 88.42 }, functions: { total: 8, covered: 8, skipped: 0, pct: 100 }, branches: { total: 20, covered: 16, skipped: 0, pct: 80 } } },
    },
    contract_verification: {
      total: 3,
      verified: 1,
      partial: 1,
      failed: 1,
      summary: "Contracts: C1 verified, C2 partial, C3 failed",
    },
  };
  writeFileSync(resolve(ritsuDir, "last-quality-gate.json"), JSON.stringify(qualityGate), "utf-8");
  files.push(resolve(ritsuDir, "last-quality-gate.json"));

  return files;
}
