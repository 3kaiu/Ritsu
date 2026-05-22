import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ritsu_join_trace } from "../../src/handlers/span-orchestrator.js";
import { getCurrentMonthFilename } from "../../src/ctx-path.js";
import { _resetReaderCache } from "../../src/ctx-reader.js";

describe("ritsu_join_trace", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-join-trace-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    _resetReaderCache();
  });

  afterEach(() => {
    _resetReaderCache();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reconstructs the span tree and reports incomplete coordination", async () => {
    const traceId = "trace-demo";
    const ritsuDir = join(testRoot, ".ritsu");
    const ctxPath = join(ritsuDir, getCurrentMonthFilename());
    const coordinationFile = "coordination-sheet-sample.md";

    writeFileSync(
      ctxPath,
      [
        {
          trace_id: traceId,
          span_id: "span-deadbeef",
          status: "started",
          skill: "think",
          domain: "fullstack",
        },
        {
          trace_id: traceId,
          span_id: "span-cafebabe",
          parent_span_id: "span-deadbeef",
          status: "started",
          skill: "dev",
          domain: "fullstack",
        },
        {
          trace_id: traceId,
          span_id: "span-cafebabe",
          parent_span_id: "span-deadbeef",
          status: "done",
        },
        {
          trace_id: traceId,
          span_id: "span-deadbeef",
          status: "artifact_written",
          artifact: coordinationFile,
        },
        {
          trace_id: traceId,
          span_id: "span-deadbeef",
          status: "done",
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
      "utf-8",
    );

    writeFileSync(
      join(ritsuDir, coordinationFile),
      [
        "| Span | Role | Description | Priority |",
        "| --- | --- | --- | --- |",
        "| span-deadbeef | think | Root task | P1 |",
        "| span-cafebabe | dev | Child task | P1 |",
        "| span-badd00d1 | qa | Missing task | P2 |",
      ].join("\n"),
      "utf-8",
    );

    const result = await ritsu_join_trace({ trace_id: traceId });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(result.content[0].text);
    expect(data.tree).toHaveLength(1);
    expect(data.tree[0].span_id).toBe("span-deadbeef");
    expect(data.tree[0].status).toBe("done");
    expect(data.tree[0].children).toHaveLength(1);
    expect(data.tree[0].children[0].span_id).toBe("span-cafebabe");
    expect(data.artifacts).toEqual([coordinationFile]);
    expect(data.coordination.status).toBe("partial");
    expect(data.coordination.issues).toContain(
      "Declared span span-badd00d1 is missing or not done.",
    );
  });
});
