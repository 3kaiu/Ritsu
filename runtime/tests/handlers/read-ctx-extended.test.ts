import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ritsu_read_ctx } from "../../src/handlers/ctx-controller.js";
import { _resetReaderCache } from "../../src/ctx-reader.js";
import { ensureCtxFile, getCtxPath } from "../../src/ctx-path.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ritsu_read_ctx extended", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-read-ctx-extended-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    _resetReaderCache();
  });

  afterEach(() => {
    _resetReaderCache();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  function writeEntries(entries: Array<Record<string, unknown>>): void {
    const ctxPath = ensureCtxFile(testRoot);
    writeFileSync(
      ctxPath,
      entries.map((entry) => JSON.stringify(entry)).join("\n") +
        (entries.length > 0 ? "\n" : ""),
      "utf-8",
    );
    _resetReaderCache();
  }

  it("warns when the ctx file does not exist yet", async () => {
    const result = await ritsu_read_ctx({});
    const data = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBeUndefined();
    expect(data._warning).toBe("ctx file does not exist yet — no events recorded");
    expect(data.last_incomplete).toBeNull();
    expect(data.last_completed).toBeNull();
  });

  it("warns when the ctx file exists but is empty and suggests init", async () => {
    ensureCtxFile(testRoot);

    const result = await ritsu_read_ctx({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data._warning).toBe("ctx file is empty — no events recorded this month");
    expect(data.recommended_next_step).toBe("/r-init");
    expect(data.breakpoint_summary).toContain("/r-init");
    expect(data.failed_count).toBe(0);
  });

  it("builds detailed recovery, summary, failure, and reality-check data", async () => {
    const entries: Array<Record<string, unknown>> = [];

    for (let i = 1; i <= 30; i++) {
      entries.push({
        ts: `2026-05-19T08:${String(i).padStart(2, "0")}:00.000Z`,
        correlation_id: `cid-done-${i}`,
        status: "started",
        skill: i % 2 === 0 ? "review" : "init",
        domain: i % 2 === 0 ? "backend" : "frontend",
        step: "0/1",
      });
      entries.push({
        ts: `2026-05-19T09:${String(i).padStart(2, "0")}:00.000Z`,
        correlation_id: `cid-done-${i}`,
        status: "done",
        skill: i % 2 === 0 ? "review" : "init",
        domain: i % 2 === 0 ? "backend" : "frontend",
      });
    }

    entries.push({
      ts: "2026-05-19T09:30:00.000Z",
      correlation_id: "cid-complete-dev",
      status: "started",
      skill: "dev",
      domain: "backend",
      step: "0/1",
    });

    entries.push({
      ts: "2026-05-19T09:31:00.000Z",
      correlation_id: "cid-complete-dev",
      status: "artifact_written",
      skill: "dev",
      domain: "backend",
      artifact: "reports/missing.md",
    });

    entries.push({
      ts: "2026-05-19T10:00:00.000Z",
      correlation_id: "cid-complete-dev",
      status: "done",
      skill: "dev",
      domain: "backend",
    });

    for (let i = 1; i <= 15; i++) {
      entries.push({
        ts: `2026-05-19T10:${String(i).padStart(2, "0")}:00.000Z`,
        correlation_id: `cid-start-${i}`,
        status: "started",
        skill: "think",
        domain: "frontend",
        step: `${i}/15`,
      });
    }

    entries.push(
      {
        ts: "2026-05-19T10:38:00.000Z",
        correlation_id: "cid-fail-1",
        status: "started",
        skill: "dev",
        domain: "backend",
        step: "0/1",
      },
      {
        ts: "2026-05-19T10:40:00.000Z",
        correlation_id: "cid-fail-1",
        status: "failed",
        skill: "dev",
        domain: "backend",
        error: "alpha",
      },
      {
        ts: "2026-05-19T10:39:00.000Z",
        correlation_id: "cid-fail-2",
        status: "started",
        skill: "dev",
        domain: "backend",
        step: "0/1",
      },
      {
        ts: "2026-05-19T10:41:00.000Z",
        correlation_id: "cid-fail-2",
        status: "failed",
        skill: "dev",
        domain: "backend",
        error: "omega",
      },
      {
        ts: "2026-05-19T10:42:00.000Z",
        correlation_id: "cid-active",
        status: "started",
        skill: "think",
        domain: "frontend",
        step: "2/3",
      },
      {
        ts: "2026-05-19T10:43:00.000Z",
        correlation_id: "cid-active",
        status: "artifact_written",
        skill: "think",
        domain: "frontend",
        artifact: "docs/draft.md",
      },
    );

    writeEntries(entries);

    const result = await ritsu_read_ctx({ detail: true });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.last_incomplete).toMatchObject({
      correlation_id: "cid-active",
      status: "started",
      stage: "think",
    });
    expect(data.last_completed).toMatchObject({
      correlation_id: "cid-complete-dev",
      stage: "dev",
    });
    expect(data.recovery_context).toMatchObject({
      correlation_id: "cid-active",
      last_artifact: "docs/draft.md",
      skill: "think",
      stage: "think",
    });
    expect(data.recovery_context.resume_hint).toContain("docs/draft.md");
    expect(data.reality_check).toEqual({
      desync_detected: true,
      missing_artifacts: ["reports/missing.md"],
    });
    expect(data.failed_summary).toMatchObject({
      total_failed: 2,
      by_skill: {
        dev: {
          count: 2,
          last_error: "omega",
          last_cid: "cid-fail-2",
        },
      },
    });
    expect(data.circuit_breaker_status).toMatchObject({
      consecutive_fails: 1,
      should_redirect: null,
      last_failed_skill: "dev",
      last_failed_cid: "cid-fail-2",
    });
    expect(data.recommended_next_step).toBe("/r-think");
    expect(data.breakpoint_summary).toContain("建议继续执行");
    expect(data.recent_entries_pruned).toHaveLength(10);
    expect(
      data.recent_entries_pruned.some(
        (entry: { correlation_id?: string }) =>
          entry.correlation_id === "cid-complete-dev",
      ),
    ).toBe(true);
    expect(data.summary).toMatchObject({
      tasks_total: 49,
      tasks_done: 31,
      tasks_failed: 2,
    });
  });

  it("uses artifact_written events for the last completed task reality check", async () => {
    writeEntries([
      {
        ts: "2026-05-19T09:00:00.000Z",
        correlation_id: "cid-a",
        status: "started",
        skill: "think",
        domain: "frontend",
        step: "0/1",
      },
      {
        ts: "2026-05-19T09:01:00.000Z",
        correlation_id: "cid-a",
        status: "artifact_written",
        skill: "think",
        domain: "frontend",
        artifact: "docs/kept.md",
      },
      {
        ts: "2026-05-19T09:02:00.000Z",
        correlation_id: "cid-a",
        status: "done",
        skill: "think",
        domain: "frontend",
      },
    ]);

    const result = await ritsu_read_ctx({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.last_completed).toMatchObject({
      correlation_id: "cid-a",
      status: "done",
    });
    expect(data.reality_check).toEqual({
      desync_detected: true,
      missing_artifacts: ["docs/kept.md"],
    });
  });

  it("maps completed stages to the next recommended step", async () => {
    const cases = [
      {
        skill: "init",
        expectedNext: "/r-think",
        expectedSummary: "项目已初始化。可以开始需求分析 (/r-think)。",
      },
      {
        skill: "think",
        expectedNext: "/r-dev",
        expectedSummary: "《设计单 (Design Sheet)》已完成。建议开始开发 (/r-dev)。",
      },
      {
        skill: "dev",
        expectedNext: "/r-review",
        expectedSummary: "代码实现已完成。建议进行验收审查 (/r-review)。",
      },
      {
        skill: "review",
        expectedNext: null,
        expectedSummary: "上一次验收已完成。所有交付已闭环。",
      },
      {
        skill: "hunt",
        expectedNext: null,
        expectedSummary: "上一次任务 (hunt) 已完成。",
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      writeEntries([
        {
          ts: `2026-05-19T11:${String(index).padStart(2, "0")}:00.000Z`,
          correlation_id: `cid-stage-${index + 1}`,
          status: "done",
          skill: testCase.skill,
          domain: "backend",
        },
      ]);

      const result = await ritsu_read_ctx({});
      const data = JSON.parse(result.content[0].text as string);

      expect(data.recommended_next_step).toBe(testCase.expectedNext);
      expect(data.breakpoint_summary).toBe(testCase.expectedSummary);
    }
  });

  it("uses tail reads for large compact ctx files", async () => {
    const entries: Array<Record<string, unknown>> = [];

    for (let i = 1; i <= 300; i++) {
      entries.push({
        ts: `2026-05-19T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
        correlation_id: `cid-large-${i}`,
        status: "done",
        skill: "dev",
        domain: "backend",
        payload: "x".repeat(1000),
      });
    }

    writeEntries(entries);
    expect(getCtxPath(testRoot)).toBeTruthy();

    const result = await ritsu_read_ctx({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.summary).toMatchObject({
      tasks_total: 50,
      tasks_done: 50,
    });
    expect(data.failed_count).toBe(0);
    expect(data.last_completed.correlation_id).toBe("cid-large-300");
    expect(data.recent_entries).toHaveLength(10);
  });
});
