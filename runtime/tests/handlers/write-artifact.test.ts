import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as gitUtils from "../../src/handlers/_git-utils.js";

vi.mock("../../src/policy/index.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    evaluatePolicies: vi.fn((ctx: any) => {
      if (ctx.content && ctx.content.includes("TODO")) {
        return {
          passed: false,
          violations: [
            { severity: "hard_stop", message: "content contains placeholder", rule_id: "HC-2" }
          ]
        };
      }
      return { passed: true, violations: [] };
    })
  };
});
vi.mock("../../src/handlers/_git-utils.js");

import {
  ARTIFACT_VALIDATION_ERROR_TYPE,
  buildArtifactErrorPayload,
  buildArtifactValidationViolation,
  buildArtifactValidationViolations,
  collectArtifactContentIssuesDetailed,
  collectArtifactMarkerActuals,
  joinArtifactViolationMessages,
  ritsu_write_artifact,
  validateArtifactContentDetailed,
} from "../../src/handlers/artifact-manager.js";
import {
  existsSync,
  mkdirSync,
  rmSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { getCtxPath } from "../../src/ctx-path.js";

function validDesignSheetContent(goal = "test"): string {
  return [
    "## 1. 任务识别 (Intake)",
    "- 任务类型: 新功能",
    `- 当前目标: ${goal}`,
    "- 风险等级: standard",
    "## 2. 方案与边界 (Plan)",
    `- 交付目标: ${goal}`,
    `- 纳入范围: ${goal}`,
    `- 不纳入范围: ${goal}`,
    "## 3. 技术契约 (Contract)",
    `- API / 接口契约: ${goal}`,
    `- 数据模型: ${goal}`,
    `- 组件契约: ${goal}`,
    "## 4. 决策理由 (Decision Rationale)",
    `- 关键决策: ${goal}`,
    `- 被拒绝方案: ${goal}`,
    "## 5. 代价与风险 (Metrics & Risks)",
    `- 回滚步骤: ${goal}`,
    "## 6. 实施清单 (Execution)",
    "- 实施步骤:",
    "  - [ ] `index.ts`: test",
    "- verification_plan:",
    "  - contracts: lint + unit test",
    `- 验证计划: ${goal}`,
  ].join("\n");
}

function writeQualityGateSnapshot(
  root: string,
  snapshot?: Record<string, unknown>,
): void {
  mkdirSync(resolve(root, ".ritsu"), { recursive: true });
  writeFileSync(
    resolve(root, ".ritsu/last-quality-gate.json"),
    JSON.stringify(
      snapshot ?? {
        recorded_at: "20260519-100000",
        passed: true,
        status: "passed",
        lint: { status: "passed", output: "lint ok" },
        test: { status: "passed", failures: [], output: "test ok" },
        coverage: {
          summary: { lines: { pct: 87.5, covered: 7, total: 8 } },
          total: { lines: { pct: 87.5, covered: 7, total: 8 } },
          per_file: {},
        },
      },
    ),
    "utf-8",
  );
}

function validDevReportContent(overrides?: {
  overall?: string;
  lint?: string;
  test?: string;
  coverage?: string;
}): string {
  return [
    "## 交付摘要",
    "- 实施结果: 完成",
    "- 验证结果: 通过",
    "- 质量门禁对账 (Quality Gates):",
    `  - 总状态: ${overrides?.overall ?? "passed"}`,
    `  - Lint: ${overrides?.lint ?? "passed"}`,
    `  - Test: ${overrides?.test ?? "passed"}`,
    `  - 覆盖率 (Lines): ${overrides?.coverage ?? "87.5%"}`,
    "## 变更明细",
    "- 主要产出: 代码与测试",
    "- 关联设计单: .ritsu/design-sheet-demo.md",
  ].join("\n");
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function buildWorktreeSnapshot(overrides?: {
  head?: string;
  stagedFiles?: string[];
  unstagedFiles?: string[];
  stagedPatch?: string;
  unstagedPatch?: string;
  untrackedFiles?: string[];
  untrackedEntries?: string[];
}) {
  const staged = {
    files: overrides?.stagedFiles ?? [],
    patch_hash: hashText(overrides?.stagedPatch ?? ""),
  };
  const unstaged = {
    files: overrides?.unstagedFiles ?? [],
    patch_hash: hashText(overrides?.unstagedPatch ?? ""),
  };
  const untracked = {
    files: overrides?.untrackedFiles ?? [],
    content_hash: hashText((overrides?.untrackedEntries ?? []).join("\n")),
  };
  return {
    head: overrides?.head,
    staged,
    unstaged,
    untracked,
    fingerprint: hashText(
      JSON.stringify({
        head: overrides?.head,
        staged,
        unstaged,
        untracked,
      }),
    ),
  };
}

function mockNoGitWorktree(): void {
  vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
      return { ok: false, output: "fatal: not a git repo" };
    }
    return { ok: false, output: `unexpected git args: ${args.join(" ")}` };
  });
}

function mockGitWorktreeState(overrides?: {
  head?: string;
  stagedFiles?: string[];
  unstagedFiles?: string[];
  stagedPatch?: string;
  unstagedPatch?: string;
  untrackedFiles?: string[];
}): void {
  vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
    const cmd = args.join(" ");
    switch (cmd) {
      case "rev-parse --is-inside-work-tree":
        return { ok: true, output: "true" };
      case "rev-parse --verify HEAD":
        return { ok: true, output: overrides?.head ?? "abc123" };
      case "diff --name-only --cached --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.stagedFiles ?? []).join("\n") };
      case "diff --name-only --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.unstagedFiles ?? []).join("\n") };
      case "diff --binary --cached --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: overrides?.stagedPatch ?? "" };
      case "diff --binary --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: overrides?.unstagedPatch ?? "" };
      case "ls-files --others --exclude-standard -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.untrackedFiles ?? []).join("\n") };
      default:
        return { ok: false, output: `unexpected git args: ${cmd}` };
    }
  });
}

describe("ritsu_write_artifact", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-write-artifact-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    vi.clearAllMocks();
    mockNoGitWorktree();
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should block content with placeholders", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-test.md",
      content: "## 1. 任务识别 (Intake)\n- 任务类型: TODO\n- 当前目标: 待定",
    };

    const result = await ritsu_write_artifact(params);
    expect(result.content[0].text).toContain("[HC-2] content contains placeholder");

    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8")
      .trim()
      .split("\n");
    const event = JSON.parse(ctxLines[0]);
    expect(event.status).toBe("violation_detected");
    expect(event.violation.rule_id).toBe("HC-2");
  });

  it("should allow content with words like TodoMVC (false positive fix)", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-todomvc.md",
      content: "## 1. 任务识别 (Intake)\n- 任务类型: 新功能\n- 当前目标: 参考 TodoMVC 实现\n- 风险等级: standard\n## 2. 方案与边界 (Plan)\n- 交付目标: 完成\n- 纳入范围: 全部\n- 不纳入范围: 无\n## 3. 技术契约 (Contract)\n- API / 接口契约: n/a\n- 数据模型: n/a\n- 组件契约: n/a\n## 4. 决策理由 (Decision Rationale)\n- 关键决策: n/a\n- 被拒绝方案: n/a\n## 5. 代价与风险 (Metrics & Risks)\n- 回滚步骤: n/a\n## 6. 实施清单 (Execution)\n- 实施步骤:\n  - [ ] `test.ts`: init\n- 验证计划: manual",
    };

    const result = await ritsu_write_artifact(params);
    if (result.isError) {
        expect(result.content[0].text).not.toContain("[HC-2] content contains placeholder");
    } else {
        expect(result.isError).toBeUndefined();
    }
  });

  it("should validate artifact schema sections", async () => {
    const params = {
      type: "design-sheet",
      filename: "design-sheet-invalid.md",
      content: "Short content",
    };

    const result = await ritsu_write_artifact(params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ArtifactValidationError");
  });

  it("should write artifact successfully if valid", async () => {
    const filename = "design-sheet-valid.md";
    const params = {
      type: "design-sheet",
      filename,
      content: validDesignSheetContent(),
    };

    const result = await ritsu_write_artifact(params);
    if (result.isError) {
      console.error("WRITE ERROR:", result.content[0].text);
    }
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(existsSync(data.path)).toBe(true);
    expect(data.artifact_meta.summary).toBeDefined();

    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8")
      .trim()
      .split("\n");
    expect(ctxLines).toHaveLength(1);
    const event = JSON.parse(ctxLines[0]);
    expect(event.status).toBe("artifact_written");
    expect(event.artifact).toBe(filename);
  });

  it("returns structured errors for missing required fields", async () => {
    const result = await ritsu_write_artifact({
      type: "design-sheet",
      filename: "",
      content: "",
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.type).toBe("ArtifactWriteError");
    expect(payload.error.violations[0]).toMatchObject({
      code: "missing_required_fields",
      path: "params",
      expected: ["type", "filename", "content"],
      actual: ["type"],
    });
  });

  it("rejects invalid artifact types, prefix mismatches, and path traversal", async () => {
    const content = validDesignSheetContent();

    const invalidType = await ritsu_write_artifact({
      type: "mystery-sheet",
      filename: "mystery-sheet-demo.md",
      content,
    });
    const invalidTypePayload = JSON.parse(invalidType.content[0].text as string);
    expect(invalidTypePayload.error.violations[0].code).toBe("invalid_artifact_type");

    const badPrefix = await ritsu_write_artifact({
      type: "design-sheet",
      filename: "design-brief-demo.md",
      content,
    });
    const badPrefixPayload = JSON.parse(badPrefix.content[0].text as string);
    expect(badPrefixPayload.error.violations[0].code).toBe("filename_prefix_mismatch");

    const traversal = await ritsu_write_artifact({
      type: "design-sheet",
      filename: "design-sheet-subdir/demo.md",
      content,
    });
    const traversalPayload = JSON.parse(traversal.content[0].text as string);
    expect(traversalPayload.error.violations[0].code).toBe("path_traversal");
  });

  it("protects existing files unless overwrite is enabled", async () => {
    const filename = "design-sheet-overwrite.md";
    const first = await ritsu_write_artifact({
      type: "design-sheet",
      filename,
      content: validDesignSheetContent("first"),
    });
    expect(first.isError).toBeUndefined();

    const blocked = await ritsu_write_artifact({
      type: "design-sheet",
      filename,
      content: validDesignSheetContent("second"),
    });
    const blockedPayload = JSON.parse(blocked.content[0].text as string);
    expect(blockedPayload.error.violations[0].code).toBe("file_exists");

    const overwritten = await ritsu_write_artifact({
      type: "design-sheet",
      filename,
      content: validDesignSheetContent("second"),
      overwrite: true,
    });
    const overwrittenData = JSON.parse(overwritten.content[0].text as string);
    expect(readFileSync(overwrittenData.path, "utf-8")).toContain("当前目标: second");
  });

  it("rejects artifact events that fail ctx schema validation", async () => {
    const result = await ritsu_write_artifact({
      type: "design-sheet",
      filename: "design-sheet-invalid-event.md",
      content: validDesignSheetContent(),
      skill: "bogus",
      domain: "frontend",
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.violations[0].code).toBe("artifact_event_invalid");
    expect(payload.error.violations[0].message).toContain("artifact event validation failed");
  });

  it("requires a quality gate snapshot before writing dev-report", async () => {
    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-missing-gates.md",
      content: validDevReportContent(),
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.violations[0].code).toBe("quality_gates_missing_snapshot");

    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8")
      .trim()
      .split("\n");
    const event = JSON.parse(ctxLines[0]);
    expect(event.violation.rule_id).toBe("AP-5");
  });

  it("rejects dev-report when quality gate fields do not match the latest snapshot", async () => {
    writeQualityGateSnapshot(testRoot);

    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-mismatch.md",
      content: validDevReportContent({ test: "failed" }),
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.violations[0].code).toBe("quality_gates_result_mismatch");
    expect(payload.error.violations[0].message).toContain("test status");
  });

  it("rejects dev-report when the latest quality gate snapshot belongs to another trace/span", async () => {
    writeQualityGateSnapshot(testRoot, {
      recorded_at: "20260519-100000",
      passed: true,
      status: "passed",
      context: {
        trace_id: "trace-20260519-0000000000000001",
        span_id: "span-root1111",
        skill: "dev",
        domain: "fullstack",
      },
      lint: { status: "passed", output: "lint ok" },
      test: { status: "passed", failures: [], output: "test ok" },
      coverage: {
        summary: { lines: { pct: 87.5, covered: 7, total: 8 } },
        total: { lines: { pct: 87.5, covered: 7, total: 8 } },
        per_file: {},
      },
    });

    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-stale-trace.md",
      content: validDevReportContent(),
      trace_id: "trace-20260519-0000000000000002",
      span_id: "span-root2222",
      skill: "dev",
      domain: "fullstack",
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.violations[0].code).toBe("quality_gates_context_mismatch");
    expect(payload.error.violations[0].message).toContain("different span");
  });

  it("rejects dev-report when tracked changes differ from the quality gate worktree snapshot", async () => {
    mockGitWorktreeState({
      head: "deadbeef",
      unstagedFiles: ["src/main.ts"],
      unstagedPatch: "changed after gates",
    });
    writeQualityGateSnapshot(testRoot, {
      recorded_at: "20260519-100000",
      passed: true,
      status: "passed",
      context: {
        trace_id: "trace-20260519-0000000000000009",
        span_id: "span-deadbeef",
        skill: "dev",
        domain: "fullstack",
      },
      worktree: buildWorktreeSnapshot({
        head: "deadbeef",
        unstagedFiles: ["src/main.ts"],
        unstagedPatch: "before more edits",
      }),
      lint: { status: "passed", output: "lint ok" },
      test: { status: "passed", failures: [], output: "test ok" },
      coverage: {
        summary: { lines: { pct: 87.5, covered: 7, total: 8 } },
        total: { lines: { pct: 87.5, covered: 7, total: 8 } },
        per_file: {},
      },
    });

    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-stale-worktree.md",
      content: validDevReportContent(),
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
    });
    const payload = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBe(true);
    expect(payload.error.violations[0].code).toBe("quality_gates_worktree_mismatch");
    expect(payload.error.violations[0].message).toContain("unstaged changes differ");
  });

  it("writes dev-report when the structured quality gate summary matches the snapshot", async () => {
    writeQualityGateSnapshot(testRoot);

    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-valid.md",
      content: validDevReportContent(),
      skill: "dev",
      domain: "fullstack",
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text as string);
    expect(existsSync(data.path)).toBe(true);
    expect(readFileSync(data.path, "utf-8")).toContain("质量门禁对账 (Quality Gates)");
  });

  it("writes dev-report when the latest quality gate snapshot matches the current trace/span", async () => {
    mockGitWorktreeState({
      head: "deadbeef",
      unstagedFiles: ["src/main.ts"],
      unstagedPatch: "stable working tree",
    });
    writeQualityGateSnapshot(testRoot, {
      recorded_at: "20260519-100000",
      passed: true,
      status: "passed",
      context: {
        trace_id: "trace-20260519-0000000000000009",
        span_id: "span-deadbeef",
        skill: "dev",
        domain: "fullstack",
      },
      worktree: buildWorktreeSnapshot({
        head: "deadbeef",
        unstagedFiles: ["src/main.ts"],
        unstagedPatch: "stable working tree",
      }),
      lint: { status: "passed", output: "lint ok" },
      test: { status: "passed", failures: [], output: "test ok" },
      coverage: {
        summary: { lines: { pct: 87.5, covered: 7, total: 8 } },
        total: { lines: { pct: 87.5, covered: 7, total: 8 } },
        per_file: {},
      },
    });

    const result = await ritsu_write_artifact({
      type: "dev-report",
      filename: "dev-report-bound-trace.md",
      content: validDevReportContent(),
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
    });

    expect(result.isError).toBeUndefined();
  });

  it("exposes helper behavior for marker extraction and validation payloads", () => {
    expect(
      collectArtifactMarkerActuals(
        [
          "- contracts: lint",
          "- contracts: lint",
          "- unrelated: ignore",
        ].join("\n"),
        "contracts: required",
      ),
    ).toEqual(["- contracts: lint"]);
    expect(collectArtifactMarkerActuals("x", "")).toEqual([]);
    expect(validateArtifactContentDetailed("unknown-type", "anything")).toBeNull();

    const issues = collectArtifactContentIssuesDetailed(
      "dev-report",
      ["## 交付摘要", "- 实施结果: ok", "- 验证结果: ok", "## 变更明细"].join("\n"),
    );
    expect(
      issues.some((issue) => issue.field_label === "质量门禁对账 (Quality Gates)"),
    ).toBe(true);
    expect(issues.some((issue) => issue.field_label === "总状态")).toBe(true);
    expect(issues.some((issue) => issue.field_label === "Lint")).toBe(true);
    expect(issues.some((issue) => issue.field_label === "Test")).toBe(true);
    expect(
      issues.some((issue) => issue.message.includes("Quality Gates")),
    ).toBe(true);

    const violation = buildArtifactValidationViolation({
      code: "artifact_schema_missing_section",
      message: "missing section",
      path: "artifact.sections.Foo",
      artifact_type: "design-sheet",
      section_title: "Foo",
      actual: ["Bar"],
    });
    expect(violation.expected).toEqual(["## Foo"]);

    const violations = buildArtifactValidationViolations([
      {
        code: "artifact_schema_missing_field_label",
        message: "missing field",
        path: "artifact.sections.Foo.fields.Bar",
        artifact_type: "design-sheet",
        field_label: "Bar",
        actual: ["Baz"],
      },
    ]);
    expect(violations[0].expected).toEqual(["Bar"]);

    expect(
      joinArtifactViolationMessages([{ message: "one" }, { message: "" }, { message: "two" }]),
    ).toBe("one; two");
    expect(
      buildArtifactErrorPayload(ARTIFACT_VALIDATION_ERROR_TYPE, [], "fallback"),
    ).toEqual({
      error: {
        type: ARTIFACT_VALIDATION_ERROR_TYPE,
        message: "fallback",
        violations: [],
      },
    });
  });
});
