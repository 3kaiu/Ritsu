import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ritsu_file_lease } from "../../src/handlers/file-lease.js";
import { ritsu_span_lifecycle } from "../../src/handlers/span-orchestrator.js";
import { ritsu_inspect_git_changes } from "../../src/handlers/diff-analyzer.js";
import { ritsu_task_coordination } from "../../src/handlers/task-protocol.js";

describe("consolidated tools handlers", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-consolidated-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should handle ritsu_file_lease correctly", async () => {
    // claim lease
    const claimRes = await ritsu_file_lease({
      action: "claim",
      path: "src/app.ts",
      span_id: "span-1234",
    });
    const claimData = JSON.parse(claimRes.content[0].text as string);
    expect(claimData.ok).toBe(true);

    // list leases
    const listRes = await ritsu_file_lease({ action: "list" });
    const listData = JSON.parse(listRes.content[0].text as string);
    expect(listData.leases).toHaveLength(1);
    expect(listData.leases[0].path).toBe("src/app.ts");

    // release lease
    const releaseRes = await ritsu_file_lease({
      action: "release",
      path: "src/app.ts",
      span_id: "span-1234",
    });
    const releaseData = JSON.parse(releaseRes.content[0].text as string);
    expect(releaseData.ok).toBe(true);

    // list again should be empty
    const listRes2 = await ritsu_file_lease({ action: "list" });
    const listData2 = JSON.parse(listRes2.content[0].text as string);
    expect(listData2.leases).toHaveLength(0);
  });

  it("should handle ritsu_span_lifecycle correctly", async () => {
    // open span
    const openRes = await ritsu_span_lifecycle({
      action: "open",
      skill: "think",
      domain: "frontend",
      step: "1/5",
    });
    const openData = JSON.parse(openRes.content[0].text as string);
    expect(openData.trace_id).toBeDefined();
    expect(openData.span_id).toBeDefined();
    expect(openData.status).toBe("started");

    // close span
    const closeRes = await ritsu_span_lifecycle({
      action: "close",
      trace_id: openData.trace_id,
      span_id: openData.span_id,
      status: "done",
      skill: "think",
      domain: "frontend",
      step: "2/5",
    });
    const closeData = JSON.parse(closeRes.content[0].text as string);
    expect(closeData.trace_id).toBe(openData.trace_id);
    expect(closeData.span_id).toBe(openData.span_id);
    expect(closeData.status).toBe("done");
  });

  it("should handle ritsu_inspect_git_changes correctly", async () => {
    const res = await ritsu_inspect_git_changes({ mode: "status" });
    expect(res.content[0].text).toBeDefined();
  });

  it("should handle ritsu_task_coordination correctly", async () => {
    // list tasks
    const listRes = await ritsu_task_coordination({ action: "list" });
    const listData = JSON.parse(listRes.content[0].text as string);
    expect(listData.tasks).toBeDefined();

    // claim task
    const claimRes = await ritsu_task_coordination({
      action: "claim",
      span_id: "span-task-1",
      agent_id: "agent-1",
    });
    const claimData = JSON.parse(claimRes.content[0].text as string);
    expect(claimData.ok).toBe(true);
  });
});
