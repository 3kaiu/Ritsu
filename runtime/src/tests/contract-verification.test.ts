/**
 * Tests for contract-registry.ts and contract-verification.ts
 *
 * v8.3.0
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, mkdtempSync } from "node:fs";

import {
  syncFromDesignSheet,
  updateContractStatus,
  getActiveContracts,
  batchUpdateStatus,
  type ContractEntry,
  type ContractRegistry,
} from "../contract-registry.js";
import { DataStore } from "../data-store.js";
import { resolve } from "node:path";

import {
  verifyContracts,
  verifyContractsById,
} from "../contract-verification.js";

// ─── Fixtures ─────────────────────────────────────────────────

const SAMPLE_DESIGN_SHEET = `# Design Sheet

## 1. 任务识别 (Intake)
- 任务类型: 新功能
- 当前目标: User dashboard with orders
- 风险等级: critical

## 3. 技术契约 (Contract)
| Contract | Description | Test Hint |
| --- | --- | --- |
| C1 | User dashboard React component | components/Dashboard.test.tsx |
| C2 | GET /api/orders endpoint | tests/orders.test.ts |
| C3 | WebSocket for live updates | tests/ws.test.ts |

## 6. 实施清单 (Execution)
- [ ] \`ui/dashboard/Dashboard.tsx\`: Main component
- [ ] \`api/routes/orders.ts\`: Orders API
`;

// ─── Tests ───────────────────────────────────────────────────

describe("ContractRegistry", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-cr-"));
    mkdirSync(join(tmpDir, ".ritsu"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty registry when no file exists", () => {
    const store = new DataStore<ContractRegistry>(resolve(tmpDir, ".ritsu", "contracts.json"), () => ({
      version: 1, updated_at: "", contracts: [], design_sheets_index: [],
    }));
    const registry = store.read();
    expect(registry.version).toBe(1);
    expect(registry.contracts).toEqual([]);
  });

  it("should write and read registry", () => {
    const store = new DataStore<ContractRegistry>(resolve(tmpDir, ".ritsu", "contracts.json"), () => ({
      version: 1, updated_at: "", contracts: [], design_sheets_index: [],
    }));
    const data: ContractRegistry = {
      version: 1,
      updated_at: new Date().toISOString(),
      contracts: [
        { id: "C1", description: "test contract", test_file_hint: "tests/test.ts", domain: "fullstack", status: "pending", evidence: "", design_sheet: "design-sheet-1.md", created_at: new Date().toISOString() },
      ],
      design_sheets_index: ["design-sheet-1.md"],
    };
    store.write(data);

    const read = store.read();
    expect(read.contracts.length).toBe(1);
    expect(read.contracts[0].id).toBe("C1");
  });

  it("should sync contracts from design-sheet content", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "ritsu-test-cr2-"));
    mkdirSync(join(freshDir, ".ritsu"), { recursive: true });

    const result = syncFromDesignSheet(freshDir, SAMPLE_DESIGN_SHEET, "design-sheet-test.md");
    expect(result.new_count).toBe(3);
    expect(result.deprecate_count).toBe(0);

    const store = new DataStore<ContractRegistry>(resolve(freshDir, ".ritsu", "contracts.json"), () => ({
      version: 1, updated_at: "", contracts: [], design_sheets_index: [],
    }));
    const registry = store.read();
    expect(registry.contracts.length).toBe(3);
    expect(registry.design_sheets_index).toContain("design-sheet-test.md");

    rmSync(freshDir, { recursive: true, force: true });
  });

  it("should update contract status", () => {
    const updated = updateContractStatus(tmpDir, "C1", "verified", "tests/dashboard.test.ts:42");
    expect(updated).toBe(true);

    const store = new DataStore<ContractRegistry>(resolve(tmpDir, ".ritsu", "contracts.json"), () => ({
      version: 1, updated_at: "", contracts: [], design_sheets_index: [],
    }));
    const registry = store.read();
    const c1 = registry.contracts.find((c) => c.id === "C1");
    expect(c1?.status).toBe("verified");
    expect(c1?.evidence).toBe("tests/dashboard.test.ts:42");
    expect(c1?.verified_at).toBeDefined();
  });

  it("should return active contracts", () => {
    const active = getActiveContracts(tmpDir);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((c) => c.status !== "deprecated")).toBe(true);
  });

  it("should batch update status by design-sheet", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "ritsu-test-bu-"));
    mkdirSync(join(freshDir, ".ritsu"), { recursive: true });

    syncFromDesignSheet(freshDir, SAMPLE_DESIGN_SHEET, "design-sheet-test.md");
    const count = batchUpdateStatus(freshDir, "design-sheet-test.md", "verified");
    expect(count).toBe(3);

    rmSync(freshDir, { recursive: true, force: true });
  });

  it("should return false for non-existent contract update", () => {
    const updated = updateContractStatus(tmpDir, "NONEXISTENT", "verified");
    expect(updated).toBe(false);
  });
});

describe("ContractVerification", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-cv-"));
    mkdirSync(join(tmpDir, ".ritsu"), { recursive: true });

    // Create some test files that match contract hints
    mkdirSync(join(tmpDir, "components"), { recursive: true });
    mkdirSync(join(tmpDir, "tests"), { recursive: true });
    mkdirSync(join(tmpDir, "ui", "dashboard"), { recursive: true });

    // C1 test file with contract annotation
    writeFileSync(
      join(tmpDir, "components", "Dashboard.test.tsx"),
      `// covers: C1
import { render } from "@testing-library/react";
import Dashboard from "./Dashboard";

describe("C1 - User Dashboard", () => {
  it("renders without crashing", () => {
    const { getByText } = render(<Dashboard />);
    expect(getByText("Dashboard")).toBeDefined();
  });
});
`,
      "utf-8",
    );

    // C2 test file with keyword match but no explicit annotation
    writeFileSync(
      join(tmpDir, "tests", "orders.test.ts"),
      `import { describe, it, expect } from "vitest";

describe("Orders API", () => {
  it("GET /api/orders returns paginated results", async () => {
    const response = await fetch("/api/orders");
    expect(response.status).toBe(200);
  });
});
`,
      "utf-8",
    );

    // C3 no test file at the hinted path
    // (tests/ws.test.ts intentionally missing)
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty report when no contracts registered", () => {
    const report = verifyContracts(tmpDir);
    expect(report.total).toBe(0);
    expect(report.summary).toContain("No contracts found");
  });

  it("should verify contracts at three levels", () => {
    // First sync the design-sheet
    syncFromDesignSheet(tmpDir, SAMPLE_DESIGN_SHEET, "design-sheet-test.md");

    const report = verifyContracts(tmpDir);

    // Should have found contracts
    expect(report.total).toBeGreaterThanOrEqual(3);

    // C1 should be verified (file exists + annotation comment)
    const c1 = report.results.find((r) => r.contract_id === "C1");
    expect(c1).toBeDefined();
    expect(c1?.level_1.status).toBe("pass");
    expect(c1?.level_2.status).toBe("pass");
    expect(c1?.overall).toBe("verified");

    // C2 should be partial or verified (file exists, keyword match in test name)
    const c2 = report.results.find((r) => r.contract_id === "C2");
    expect(c2).toBeDefined();
    expect(c2?.level_1.status).toBe("pass");
    // Either verified (keyword matched) or partial (no explicit annotation)
    expect(["verified", "partial"]).toContain(c2?.overall);

    // C3 should fail (no test file at hinted path)
    const c3 = report.results.find((r) => r.contract_id === "C3");
    expect(c3).toBeDefined();
    expect(c3?.level_1.status).toBe("fail");
    expect(c3?.overall).toBe("failed");
  });

  it("should filter contracts by ID", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "ritsu-test-cv2-"));
    mkdirSync(join(freshDir, ".ritsu"), { recursive: true });
    mkdirSync(join(freshDir, "components"), { recursive: true });

    // Create matching test file for C1
    writeFileSync(
      join(freshDir, "components", "Dashboard.test.tsx"),
      `// covers: C1\nimport { render } from "@testing-library/react";\n`,
      "utf-8",
    );

    syncFromDesignSheet(freshDir, SAMPLE_DESIGN_SHEET, "design-sheet-test.md");
    const report = verifyContractsById(freshDir, ["C1"]);
    expect(report.total).toBe(1);
    expect(report.results[0].contract_id).toBe("C1");

    rmSync(freshDir, { recursive: true, force: true });
  });
});
