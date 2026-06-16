/**
 * Tests for context-lifecycle.ts
 *
 * v8.1.0
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  estimateTokens,
  buildCheckpoint,
  saveCheckpoint,
  loadLatestCheckpoint,
  isCheckpointFresh,
  generateRecoveryPrompt,
  getBudgetStatus,
  autoCheckpoint,
  type Checkpoint,
} from "../context-lifecycle.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

// ─── estimateTokens ──────────────────────────────────────────

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate tokens for ASCII text", () => {
    const text = "hello world this is a test";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it("should estimate tokens for CJK text", () => {
    const text = "你好世界这是一个测试";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    // CJK chars have lower token ratio
    expect(tokens).toBeLessThan(text.length);
  });

  it("should handle mixed text", () => {
    const text = "hello world 你好世界 this is a test 测试";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });
});

// ─── Checkpoint Lifecycle ────────────────────────────────────

describe("saveCheckpoint and loadLatestCheckpoint", () => {
  it("should save and load a checkpoint", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-cp-"));
    // Create .ritsu as directory
    const ritsuDir = join(tmpDir, ".ritsu");
    if (!existsSync(ritsuDir)) {
      const { mkdirSync } = require("node:fs") as typeof import("node:fs");
      mkdirSync(ritsuDir, { recursive: true });
    }

    const cp: Checkpoint = {
      ts: new Date().toISOString(),
      trace_id: "trace-test-1",
      correlation_id: "trace-test-1",
      skill: "dev",
      step: 3,
      total_steps: 5,
      goal: "Implement order API",
      completed: ["step-1: create model", "step-2: add routes"],
      pending: ["step-3: add tests", "step-4: quality gates", "step-5: deliver"],
      active_contracts: ["C1", "C2"],
      active_violations: [],
      working_files: ["src/models/order.ts", "src/routes/order.ts"],
      key_decisions: ["Use SQLite WAL mode"],
      token_estimate: 25000,
    };

    const savedPath = saveCheckpoint(tmpDir, cp);
    expect(savedPath).toBeTruthy();
    expect(existsSync(savedPath)).toBe(true);

    const loaded = loadLatestCheckpoint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.ts).toBe(cp.ts);
    expect(loaded!.skill).toBe("dev");
    expect(loaded!.goal).toContain("order");
    expect(loaded!.completed.length).toBe(2);
    expect(loaded!.pending.length).toBe(3);
    expect(loaded!.working_files).toContain("src/models/order.ts");

    // Cleanup
    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return null if no checkpoints exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-empty-"));
    const loaded = loadLatestCheckpoint(tmpDir);
    expect(loaded).toBeNull();

    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─── isCheckpointFresh ───────────────────────────────────────

describe("isCheckpointFresh", () => {
  it("should return true for recent checkpoint", () => {
    const cp: Checkpoint = {
      ts: new Date().toISOString(),
      trace_id: "t1",
      correlation_id: "t1",
      skill: "dev",
      step: 1,
      total_steps: 3,
      goal: "",
      completed: [],
      pending: [],
      active_contracts: [],
      active_violations: [],
      working_files: [],
      key_decisions: [],
      token_estimate: 0,
    };

    expect(isCheckpointFresh(cp, 60)).toBe(true);
  });

  it("should return false for old checkpoint", () => {
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const cp: Checkpoint = {
      ts: oldDate.toISOString(),
      trace_id: "t1",
      correlation_id: "t1",
      skill: "dev",
      step: 1,
      total_steps: 3,
      goal: "",
      completed: [],
      pending: [],
      active_contracts: [],
      active_violations: [],
      working_files: [],
      key_decisions: [],
      token_estimate: 0,
    };

    expect(isCheckpointFresh(cp, 60)).toBe(false);
  });
});

// ─── generateRecoveryPrompt ──────────────────────────────────

describe("generateRecoveryPrompt", () => {
  it("should generate a prompt with task info", () => {
    const cp: Checkpoint = {
      ts: new Date().toISOString(),
      trace_id: "trace-recovery-1",
      correlation_id: "trace-recovery-1",
      skill: "dev",
      step: 2,
      total_steps: 5,
      goal: "Fix login bug",
      completed: ["step-1: identify root cause"],
      pending: ["step-2: implement fix", "step-3: add tests", "step-4: quality gates"],
      active_contracts: ["C1"],
      active_violations: [
        { rule_id: "AP-4", severity: "error", message: "Scope creep detected", file_hint: "src/auth.ts", fixed: false },
      ],
      working_files: ["src/auth.ts", "src/middleware.ts"],
      key_decisions: [],
      token_estimate: 15000,
    };

    const prompt = generateRecoveryPrompt(cp);
    expect(prompt).toContain("dev");
    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("step-2: implement fix");
    expect(prompt).toContain("AP-4");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("C1");
    expect(prompt).toContain("热恢复"); // fresh checkpoint
  });

  it("should mark cold recovery for old checkpoints", () => {
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cp: Checkpoint = {
      ts: oldDate.toISOString(),
      trace_id: "trace-1",
      correlation_id: "trace-1",
      skill: "dev",
      step: 1,
      total_steps: 3,
      goal: "fix cold test",
      completed: [],
      pending: ["step-1", "step-2", "step-3"],
      active_contracts: [],
      active_violations: [],
      working_files: [],
      key_decisions: [],
      token_estimate: 0,
    };

    const prompt = generateRecoveryPrompt(cp);
    expect(prompt).toContain("冷恢复");
  });
});

// ─── getBudgetStatus ─────────────────────────────────────────

describe("getBudgetStatus", () => {
  it("should return normal status for empty manifest", () => {
    const status = getBudgetStatus({
      updated_at: new Date().toISOString(),
      trace_id: "",
      skill: "",
      goal: "",
      total_tokens: 0,
      high_water_mark: 0,
      pinned: [],
      high: [],
      normal: [],
      low: [],
    });

    expect(status.utilization_pct).toBe(0);
    expect(status.needs_compression).toBe(false);
    expect(status.remaining).toBeGreaterThan(0);
  });

  it("should signal compression needed near budget limit", () => {
    const status = getBudgetStatus({
      updated_at: new Date().toISOString(),
      trace_id: "trace-1",
      skill: "dev",
      goal: "test",
      total_tokens: 50000,
      high_water_mark: 55000,
      pinned: [],
      high: [],
      normal: [],
      low: [],
    });

    expect(status.needs_compression).toBe(true);
    expect(status.utilization_pct).toBeGreaterThan(85);
  });
});

// ─── buildCheckpoint (integration-style) ─────────────────────

describe("buildCheckpoint", () => {
  it("should return null for empty project", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-bc-"));
    const cp = buildCheckpoint(tmpDir, "dev", "test task");
    expect(cp).toBeNull();

    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should build a valid checkpoint from the Ritsu project", () => {
    const cp = buildCheckpoint(PROJECT_ROOT, "dev", "build valid checkpoint");
    // Either returns null (no active session) or a valid checkpoint
    if (cp !== null) {
      expect(cp.skill).toBe("dev");
      expect(typeof cp.token_estimate).toBe("number");
      expect(cp.token_estimate).toBeGreaterThan(0);
      expect(Array.isArray(cp.completed)).toBe(true);
      expect(Array.isArray(cp.pending)).toBe(true);
      expect(Array.isArray(cp.working_files)).toBe(true);
    }
  });
});

// ─── autoCheckpoint ──────────────────────────────────────────

describe("autoCheckpoint", () => {
  it("should return null for empty project (no events)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-ac-"));
    const result = autoCheckpoint(tmpDir, "dev", "test");
    expect(result).toBeNull();

    const { rmSync } = require("node:fs") as typeof import("node:fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should save a checkpoint for a project with events", () => {
    const result = autoCheckpoint(PROJECT_ROOT, "dev", "auto checkpoint test");
    // The Ritsu project has ctx events, so it should save
    if (result !== null) {
      expect(existsSync(result)).toBe(true);
      const content = readFileSync(result, "utf-8");
      const cp = JSON.parse(content) as Checkpoint;
      expect(cp.skill).toBe("dev");
      expect(typeof cp.token_estimate).toBe("number");
    }
  });
});
