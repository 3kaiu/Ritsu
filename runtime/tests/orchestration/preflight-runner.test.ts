import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the runtime dependencies before importing
vi.mock("../../src/handlers/ctx-controller.js", () => ({
  ritsu_read_ctx: vi.fn(async (params: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify({
      last_incomplete: null,
      last_completed: null,
      recent_entries: [],
      circuit_breaker_status: { consecutive_fails: 0, should_redirect: null },
      recovery_context: null,
    })}],
  })),
}));

vi.mock("../../src/handlers/read-agents.js", () => ({
  ritsu_read_agents: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ domain: "backend", lint_cmd: "npm run lint" })}],
  })),
}));

vi.mock("../../src/handlers/diff-analyzer.js", () => ({
  ritsu_get_changed_files: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ files: [{ path: "src/index.ts", status: "M" }] })}],
  })),
}));

vi.mock("../../src/handlers/list-artifacts.js", () => ({
  ritsu_list_artifacts: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify([])}],
  })),
}));

vi.mock("../../src/handlers/exec.js", () => ({
  ritsu_exec: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ ok: true })}],
  })),
}));

vi.mock("../../src/handlers/span-orchestrator.js", () => ({
  ritsu_join_trace: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ tree: [] })}],
  })),
}));

vi.mock("../../src/orchestration/diff-inspect.js", () => ({
  inspectDiff: vi.fn(async () => ({
    ok: true,
    data: { files: [], mode: "stat" },
  })),
}));

vi.mock("../../src/orchestration/internal-tools.js", () => ({
  getToolReadiness: vi.fn(() => ({
    superpowers: false,
    codegraph: false,
    openspec: false,
    native: false,
  })),
  fetchCodeGraphContext: vi.fn(() => ({ symbols: [], files: [] })),
  runSuperpowersBrainstorming: vi.fn(() => ({ ok: false })),
}));

vi.mock("../../src/orchestration/policy-preflight.js", () => ({
  runPolicyPreflight: vi.fn(async () => ({
    passed: true,
    violations: [],
    scan_files: [],
    diff_bytes: 0,
  })),
}));

vi.mock("../../src/openspec-bridge.js", () => ({
  syncOpenSpecContracts: vi.fn(() => ({ contracts: [] })),
}));

vi.mock("../../src/similar-violations.js", () => ({
  loadViolationRecords: vi.fn(() => []),
  findSimilarViolations: vi.fn(() => []),
}));

vi.mock("../../src/orchestration/architecture-analyzer.js", () => ({
  buildArchitectureFingerprint: vi.fn(() => ({
    modules: [],
    dependencies: [],
    rules: [],
    files: [],
    capturedAt: new Date().toISOString(),
  })),
  storeArchitectureFingerprint: vi.fn(),
  buildArchitectureContext: vi.fn(() => ({ mermaid: "", modules: [], dependency_count: 0 })),
  checkArchitectureDrift: vi.fn(() => []),
}));

vi.mock("../../src/ide-rules-sync.js", () => ({
  syncArchitectureToIDERules: vi.fn(() => true),
}));


import { runStagePreflight } from "../../src/orchestration/preflight-runner.js";

const FAKE_ROOT = "/tmp/ritsu-test-preflight";

describe("runStagePreflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs think preflight and returns a context pack", async () => {
    const pack = await runStagePreflight({
      projectRoot: FAKE_ROOT,
      stage: "think",
      tier: "P1",
      taskSummary: "add logout button",
    });

    expect(pack.stage).toBe("think");
    expect(pack.passed).toBe(true);
    expect(pack._suffix).toBeDefined();
    expect(typeof pack._ai_summary).toBe("string");
    expect(pack.next_skill).toBe("dev");
  });

  it("runs dev preflight with default disclosure (level 0)", async () => {
    const pack = await runStagePreflight({
      projectRoot: FAKE_ROOT,
      stage: "dev",
      tier: "P1",
    });

    expect(pack.stage).toBe("dev");
    expect(pack.passed).toBe(true);
    expect(pack._ai_summary).toBeDefined();
  });

  it("runs hunt preflight", async () => {
    const pack = await runStagePreflight({
      projectRoot: FAKE_ROOT,
      stage: "hunt",
    });

    expect(pack.stage).toBe("hunt");
    expect(pack.next_skill).toBe("dev");
  });

  it("runs review preflight with triple-check hint", async () => {
    const pack = await runStagePreflight({
      projectRoot: FAKE_ROOT,
      stage: "review",
    });

    expect(pack.stage).toBe("review");
    expect(pack.next_skill).toBeDefined();
  });

  it("marks all responses as suffix zone", async () => {
    const stages: Array<"think" | "dev" | "hunt" | "review"> = ["think", "dev", "hunt", "review"];
    for (const stage of stages) {
      const pack = await runStagePreflight({
        projectRoot: FAKE_ROOT,
        stage,
        tier: "P1",
        taskSummary: "test",
      });
      expect(pack._suffix).toBeDefined();
    }
  });
});
