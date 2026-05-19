import { describe, expect, it, vi, beforeEach } from "vitest";

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
});
