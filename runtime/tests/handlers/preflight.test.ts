import { describe, expect, it, vi, beforeEach } from "vitest";
import { ritsu_read_ctx } from "../../src/handlers/read-ctx.js";
import { ritsu_list_artifacts } from "../../src/handlers/list-artifacts.js";

vi.mock("../../src/handlers/read-ctx.js", () => ({
  ritsu_read_ctx: vi.fn(async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          last_incomplete: null,
          last_completed: null,
          recent_entries: [],
          recovery_context: { risk_level: "standard" },
        }),
      },
    ],
  })),
}));

vi.mock("../../src/handlers/get-changed-files.js", () => ({
  ritsu_get_changed_files: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ files: [], domain: "unknown" }) }],
  })),
}));

vi.mock("../../src/orchestration/diff-inspect.js", () => ({
  inspectDiff: vi.fn(async () => ({
    ok: true,
    data: { mode: "full", files: [], truncated: false },
  })),
}));

vi.mock("../../src/orchestration/policy-preflight.js", () => ({
  runPolicyPreflight: vi.fn(async () => ({
    passed: true,
    violations: [],
    scan_files: [],
    diff_bytes: 0,
  })),
}));

vi.mock("../../src/handlers/list-artifacts.js", () => ({
  ritsu_list_artifacts: vi.fn(async () => ({
    content: [{ type: "text", text: JSON.stringify({ files: [], total_count: 0 }) }],
  })),
}));

import { ritsu_preflight } from "../../src/handlers/preflight.js";

describe("ritsu_preflight", () => {
  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = process.cwd();
  });

  it("rejects unknown stage", async () => {
    const res = await ritsu_preflight({ stage: "deploy" });
    expect(res.isError).toBe(true);
  });

  it("runs dev preflight successfully", async () => {
    const res = await ritsu_preflight({ stage: "dev" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    expect(body.ok).toBe(true);
    expect(body.context_pack.stage).toBe("dev");
  });

  it("runs dev preflight with JIT (detail: false) by default, bypassing heavy loads", async () => {
    const listMock = vi.mocked(ritsu_list_artifacts);
    listMock.mockClear();

    const res = await ritsu_preflight({ stage: "dev" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    expect(body.ok).toBe(true);

    // Bypassed list_artifacts
    expect(listMock).not.toHaveBeenCalled();
    expect(body.context_pack.artifacts).toBeUndefined();
    expect(body.context_pack.diff).toBeUndefined();
  });

  it("runs dev preflight with eager loading if detail: true", async () => {
    const listMock = vi.mocked(ritsu_list_artifacts);
    listMock.mockClear();

    const res = await ritsu_preflight({ stage: "dev", detail: true });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    expect(body.ok).toBe(true);

    // Called list_artifacts
    expect(listMock).toHaveBeenCalled();
    expect(body.context_pack.artifacts).toBeDefined();
    expect(body.context_pack.diff).toBeDefined();
  });

  it("automatically elevates to detail: true if circuit breaker is triggered (consecutive_fails >= 2)", async () => {
    const ctxMock = vi.mocked(ritsu_read_ctx);
    const listMock = vi.mocked(ritsu_list_artifacts);

    ctxMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            last_incomplete: null,
            last_completed: null,
            recent_entries: [],
            circuit_breaker_status: { consecutive_fails: 2 },
            recovery_context: { risk_level: "standard" },
          }),
        },
      ],
    });
    listMock.mockClear();

    const res = await ritsu_preflight({ stage: "dev" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    expect(body.ok).toBe(true);

    // Auto-elevated to true because consecutive_fails >= 2
    expect(listMock).toHaveBeenCalled();
    expect(body.context_pack.artifacts).toBeDefined();
  });
});
