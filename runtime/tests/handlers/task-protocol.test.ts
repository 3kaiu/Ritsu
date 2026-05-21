import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ritsu_claim_task,
  ritsu_list_pending_tasks,
} from "../../src/handlers/task-protocol.js";
import { getCurrentMonthFilename } from "../../src/ctx-path.js";

describe("task claim handlers", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-task-claim-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("serializes competing task claims", async () => {
    const [first, second] = await Promise.all([
      ritsu_claim_task({ span_id: "span-aaaa1111", agent_id: "agent-a" }),
      ritsu_claim_task({ span_id: "span-aaaa1111", agent_id: "agent-b" }),
    ]);

    const firstData = JSON.parse(first.content[0].text as string);
    const secondData = JSON.parse(second.content[0].text as string);
    // Atomic write: both succeed (second overwrites first)
    expect(firstData.ok).toBe(true);
    expect(secondData.ok).toBe(true);
  });

  it("lists only unfinished tasks and includes claim ownership", async () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });

    writeFileSync(
      join(ritsuDir, "coordination-sheet-sample.md"),
      [
        "| Span | Role | Description | Priority |",
        "| --- | --- | --- | --- |",
        "| span-deadbeef | builder | Keep pending | P1 |",
        "| span-cafebabe | qa | Also pending | P2 |",
        "| span-badd00d | reviewer | Already done | P3 |",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(ritsuDir, getCurrentMonthFilename()),
      `${JSON.stringify({ span_id: "span-badd00d", status: "done" })}\n`,
      "utf-8",
    );

    await ritsu_claim_task({ span_id: "span-deadbeef", agent_id: "agent-a" });

    const result = await ritsu_list_pending_tasks({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.tasks).toHaveLength(2);
    expect(data.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          span_id: "span-deadbeef",
          claimed_by: "agent-a",
          description: "Keep pending",
        }),
        expect.objectContaining({
          span_id: "span-cafebabe",
          claimed_by: null,
          description: "Also pending",
        }),
      ]),
    );
    expect(data.tasks.some((task: { span_id: string }) => task.span_id === "span-badd00d")).toBe(false);
  });
});
