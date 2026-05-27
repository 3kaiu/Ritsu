import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  main,
  runDoctor,
  runExport,
  runTrace,
  usage,
} from "../src/cli.js";
import type { CtxEvent } from "../src/cli.js";
import {
  buildTraceSpanForest,
  countTripleVerifiedTraces,
  findLatestCtxFile,
  formatEvent,
  formatSkill,
  getArtifactTypes,
  getLatestTraceId,
  getOpenTraceIds,
  getTraceEvents,
  normalizeTraceId,
  parseJsonl,
  parseLooseJsonl,
  readCoveragePct,
  readRuntimeMetadataFromPackageJson,
  summarizeTasks,
} from "../src/cli/shared.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[\d+m/g, "");
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  return {
    logs,
    errors,
    get output(): string {
      return stripAnsi([...logs, ...errors].join("\n"));
    },
  };
}

function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation(
    ((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as typeof process.exit,
  );
}

function writeCtx(root: string, events: Array<Record<string, unknown>>): string {
  const ritsuDir = resolve(root, ".ritsu");
  mkdirSync(ritsuDir, { recursive: true });
  const ctxPath = resolve(ritsuDir, "ctx-2026-05.jsonl");
  writeFileSync(
    ctxPath,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf-8",
  );
  return ctxPath;
}

describe("cli utilities", () => {
  let testRoot: string;
  let originalArgv: string[];
  let originalProjectRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-cli-"));
    originalArgv = [...process.argv];
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("provides usage information", () => {
    const text = usage();
    expect(text).toContain("ritsu bootstrap");
    expect(text).toContain("ritsu doctor");
    expect(text).toContain("ENV:");
  });

  it("formats skill names", () => {
    expect(formatSkill("think")).toBe("think");
  });

  it("formats events into strings", () => {
    const event: CtxEvent = {
      ts: "20260515-120000",
      correlation_id: "cid-1",
      skill: "think",
      domain: "fullstack",
      status: "done",
    };
    const output = stripAnsi(formatEvent(event));
    expect(output).toContain("cid-1");
    expect(output).toContain("think");
    expect(output).toContain("done");
  });

  it("includes optional fields and trace ids in event output", () => {
    const event: CtxEvent = {
      ts: "20260515-120000",
      correlation_id: "cid-1",
      trace_id: "trace-20260515-0000000000000001",
      span_id: "span-00000001",
      skill: "dev",
      domain: "frontend",
      status: "artifact_written",
      step: "1/2",
      artifact: "test.md",
    };
    const output = stripAnsi(formatEvent(event));
    expect(output).toContain("00000001:00000001");
    expect(output).toContain("step:1/2");
    expect(output).toContain("artifact:test.md");
  });

  it("finds the latest ctx file by sorted filename", () => {
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    writeFileSync(resolve(ritsuDir, "ctx-2026-04.jsonl"), "");
    writeFileSync(resolve(ritsuDir, "ctx-2026-05.jsonl"), "");

    expect(findLatestCtxFile(testRoot)).toBe(
      resolve(ritsuDir, "ctx-2026-05.jsonl"),
    );
  });

  it("parses jsonl and backfills legacy trace fields", () => {
    const ctxPath = resolve(testRoot, "ctx.jsonl");
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({
          ts: "2026-05-19T10:00:00.000Z",
          correlation_id: "cid-20260519-7",
          skill: "think",
          domain: "fullstack",
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:01:00.000Z",
          trace_id: "trace-20260519-0000000000000008",
          skill: "dev",
          domain: "fullstack",
          status: "done",
        }),
        "{bad json",
      ].join("\n"),
      "utf-8",
    );

    const events = parseJsonl(ctxPath);

    expect(events).toHaveLength(2);
    expect(events[0].trace_id).toBe("trace-20260519-0000000000000007");
    expect(events[0].span_id).toBe("span-00000007");
    expect(events[1].correlation_id).toBe(
      "trace-20260519-0000000000000008",
    );
  });

  it("parses loose jsonl rows and skips arrays, primitives, and bad lines", () => {
    const rowsPath = resolve(testRoot, "rows.jsonl");
    writeFileSync(
      rowsPath,
      [
        JSON.stringify({ a: 1 }),
        JSON.stringify(["not", "an", "object"]),
        JSON.stringify(42),
        "{broken",
      ].join("\n"),
      "utf-8",
    );

    expect(parseLooseJsonl(rowsPath)).toEqual([{ a: 1 }]);
  });

  it("reads coverage percentage from summary and total fallbacks", () => {
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });

    writeFileSync(
      resolve(ritsuDir, "last-quality-gate.json"),
      JSON.stringify({
        coverage: {
          summary: {
            lines: { pct: 87.5 },
          },
        },
      }),
      "utf-8",
    );
    expect(readCoveragePct(testRoot)).toBe("87.5");

    writeFileSync(
      resolve(ritsuDir, "last-quality-gate.json"),
      JSON.stringify({
        coverage: {
          total: {
            lines: { pct: 91.2 },
          },
        },
      }),
      "utf-8",
    );
    expect(readCoveragePct(testRoot)).toBe("91.2");
  });

  it("reads runtime metadata from package.json", () => {
    const pkgPath = resolve(testRoot, "package.json");
    writeFileSync(
      pkgPath,
      JSON.stringify({
        version: "6.1.0",
        ritsu_protocol_version: "6.1.0",
      }),
      "utf-8",
    );

    expect(readRuntimeMetadataFromPackageJson(pkgPath)).toEqual({
      packageVersion: "6.1.0",
      protocolVersion: "6.1.0",
    });
    expect(
      readRuntimeMetadataFromPackageJson(resolve(testRoot, "missing-package.json")),
    ).toEqual({
      packageVersion: null,
      protocolVersion: null,
    });
  });

  it("collects artifact types from artifact-written events only", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-sheet" },
      },
      {
        ts: "2",
        correlation_id: "cid-1",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: {},
      },
      {
        ts: "3",
        correlation_id: "cid-1",
        skill: "dev",
        domain: "fullstack",
        status: "done",
      },
    ];

    expect([...getArtifactTypes(events)]).toEqual(["design-sheet"]);
  });

  it("finds the latest trace id and normalizes legacy cids", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        trace_id: "trace-20260519-0000000000000001",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "2",
        correlation_id: "cid-2",
        trace_id: "trace-20260519-0000000000000002",
        skill: "dev",
        domain: "fullstack",
        status: "done",
      },
    ];

    expect(getLatestTraceId(events)).toBe("trace-20260519-0000000000000002");
    expect(normalizeTraceId("cid-20260519-9")).toBe(
      "trace-20260519-0000000000000009",
    );
    expect(normalizeTraceId("trace-20260519-0000000000000009")).toBe(
      "trace-20260519-0000000000000009",
    );
  });

  it("filters trace events using direct trace ids and legacy correlation ids", () => {
    const traceId = "trace-20260519-0000000000000007";
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-20260519-7",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "2",
        correlation_id: "cid-2",
        trace_id: traceId,
        skill: "dev",
        domain: "fullstack",
        status: "done",
      },
      {
        ts: "3",
        correlation_id: "cid-3",
        trace_id: "trace-20260519-0000000000000008",
        skill: "qa",
        domain: "fullstack",
        status: "done",
      },
    ];

    expect(getTraceEvents(events, traceId)).toHaveLength(2);
  });

  it("returns only open root traces", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_kind: "root",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "2",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_kind: "root",
        skill: "think",
        domain: "fullstack",
        status: "done",
      },
      {
        ts: "3",
        correlation_id: "cid-2",
        trace_id: "trace-2",
        span_kind: "root",
        skill: "dev",
        domain: "fullstack",
        status: "started",
      },
    ];

    expect(getOpenTraceIds(events)).toEqual(["trace-2"]);
  });

  it("counts triple-verified traces", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-sheet" },
      },
      {
        ts: "2",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "dev-report" },
      },
      {
        ts: "3",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "qa",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "assurance-sheet" },
      },
      {
        ts: "4",
        correlation_id: "cid-2",
        trace_id: "trace-2",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-brief" },
      },
    ];

    expect(countTripleVerifiedTraces(events)).toEqual({
      traceIds: ["trace-1", "trace-2"],
      triplePassed: 1,
    });
  });

  it("builds a span forest from trace events", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "2",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-child",
        parent_span_id: "span-root",
        skill: "dev",
        domain: "fullstack",
        status: "started",
      },
    ];

    const forest = buildTraceSpanForest(events);

    expect(forest).toHaveLength(1);
    expect(forest[0].id).toBe("span-root");
    expect(forest[0].children).toHaveLength(1);
    expect(forest[0].children?.[0].id).toBe("span-child");
  });

  it("summarizes tasks for export", () => {
    const events: CtxEvent[] = [
      {
        ts: "1",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "started",
        cost: { tokens_in: 10, tokens_out: 20 },
      },
      {
        ts: "2",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact: "design-sheet-test.md",
      },
      {
        ts: "3",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "done",
      },
      {
        ts: "4",
        correlation_id: "cid-2",
        skill: "dev",
        domain: "frontend",
        status: "failed",
        error: "boom",
      },
    ];

    const tasks = summarizeTasks(events);

    expect(tasks["cid-1"]).toMatchObject({
      skill: "think",
      domain: "fullstack",
      status: "completed",
      artifacts: ["design-sheet-test.md"],
      totalTokensIn: 10,
      totalTokensOut: 20,
    });
    expect(tasks["cid-2"]).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });

  it("runs doctor health and writes a snapshot with trend output", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "miner",
        domain: "fullstack",
        status: "done",
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "dev",
        domain: "fullstack",
        status: "violation_detected",
        violation: { rule_id: "AP-1", severity: "fatal" },
      },
      {
        ts: "20260519-100200",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-sheet" },
      },
      {
        ts: "20260519-100300",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "dev-report" },
      },
      {
        ts: "20260519-100400",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "qa",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "assurance-sheet" },
      },
      {
        ts: "20260519-100500",
        correlation_id: "cid-2",
        trace_id: "trace-2",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-brief" },
      },
    ]);
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        coverage: { summary: { lines: { pct: 90 } } },
      }),
      "utf-8",
    );
    writeFileSync(
      resolve(testRoot, ".ritsu/health-snapshots.jsonl"),
      `${JSON.stringify({ currentCoverage: 85 })}\n`,
      "utf-8",
    );

    await runDoctor(["--health"]);

    expect(output.output).toContain("Ritsu Health Dashboard");
    expect(output.output).toContain("Policy Interception Rate:   16.7%");
    expect(output.output).toContain("Triple Verification Rate:   50.0% (1/2 traces)");
    expect(output.output).toContain("Trend: Coverage moved +5.0% since last check.");

    const snapshotLines = readFileSync(
      resolve(testRoot, ".ritsu/health-snapshots.jsonl"),
      "utf-8",
    )
      .trim()
      .split("\n");
    expect(snapshotLines).toHaveLength(2);
    expect(JSON.parse(snapshotLines[1])).toMatchObject({
      interceptRate: "16.7",
      promoted: 1,
      currentCoverage: "90",
      tripleRate: "50.0",
      tracesCount: 2,
    });
  });



  it("runs doctor checks and exits on version mismatch", async () => {
    const output = captureConsole();
    mockProcessExit();
    writeFileSync(
      resolve(testRoot, "AGENTS.md"),
      ["ritsu-version: 0.0.0", "domain: fullstack"].join("\n"),
      "utf-8",
    );
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(resolve(testRoot, ".ritsu/stale.lock"), "", "utf-8");
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await expect(runDoctor()).rejects.toThrow("process.exit:1");

    expect(output.output).toContain("Ritsu Doctor — Running Health Check...");
    expect(output.output).toContain("AGENTS.md found");
    expect(output.output).toContain(".ritsu/ directory found");
    expect(output.output).toContain("Stale lock files found: stale.lock");
    expect(output.output).toMatch(/AGENTS\.md ritsu-version mismatch: 0\.0\.0 != \d+\.\d+\.\d+/);
    expect(output.output).toContain("Summary: 1 Errors, 1 Warnings");
  });

  it("exports task history markdown to a file", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "started",
        cost: { tokens_in: 5, tokens_out: 8 },
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact: "design-sheet-demo.md",
      },
      {
        ts: "20260519-100200",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "done",
      },
    ]);

    await runExport("report.md");

    const markdown = readFileSync(resolve(testRoot, "report.md"), "utf-8");
    expect(output.output).toContain("Exported to: report.md");
    expect(markdown).toContain("# Ritsu Task Export");
    expect(markdown).toContain("`cid-1`");
    expect(markdown).toContain("`design-sheet-demo.md`");
    expect(markdown).toContain("5 / 8");
  });

  it("checks triple verification for the latest trace", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "design-sheet" },
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "dev-report" },
      },
      {
        ts: "20260519-100200",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "qa",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "assurance-sheet" },
      },
    ]);

    await runTrace(null, false, true);

    expect(output.output).toContain("Ritsu Triple Verification");
    expect(output.output).toContain("Triple Verification Passed!");
  });

  it("lists open traces", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-closed",
        span_kind: "root",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-1",
        trace_id: "trace-closed",
        span_kind: "root",
        skill: "think",
        domain: "fullstack",
        status: "done",
      },
      {
        ts: "20260519-100200",
        correlation_id: "cid-2",
        trace_id: "trace-open",
        span_kind: "root",
        skill: "dev",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await runTrace(null, true, false);

    expect(output.output).toContain("Open Traces:");
    expect(output.output).toContain("trace-open");
    expect(output.output).not.toContain("trace-closed");
  });

  it("renders a span tree for a legacy cid trace", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-20260519-7",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-20260519-7",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact: "design-sheet-demo.md",
      },
      {
        ts: "20260519-100200",
        correlation_id: "cid-20260519-7",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "done",
        cost: { duration_ms: 42 },
      },
      {
        ts: "20260519-100300",
        correlation_id: "cid-20260519-7",
        trace_id: "trace-20260519-0000000000000007",
        span_id: "span-child",
        parent_span_id: "span-root",
        skill: "dev",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await runTrace("cid-20260519-7");

    expect(output.output).toContain(
      "Trace ID: trace-20260519-0000000000000007",
    );
    expect(output.output).toContain("Span Tree:");
    expect(output.output).toContain("artifacts: design-sheet-demo.md");
    expect(output.output).toContain("42ms");
  });

  it("exits when trace input is missing", async () => {
    const output = captureConsole();
    mockProcessExit();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await expect(runTrace(null, false, false)).rejects.toThrow(
      "process.exit:1",
    );
    expect(output.output).toContain("Please provide a trace ID or use --open");
  });

  it("prints usage for help in main()", () => {
    const output = captureConsole();
    process.argv = ["node", "cli.js", "--help"];

    main();

    expect(output.output).toContain("ritsu bootstrap");
    expect(output.output).toContain("ENV:");
  });

  it("exits for an unknown main() command", () => {
    const output = captureConsole();
    mockProcessExit();
    process.argv = ["node", "cli.js", "bogus"];

    expect(() => main()).toThrow("process.exit:1");
    expect(output.output).toContain("Unknown command: bogus");
    expect(output.output).toContain("ritsu doctor");
  });

  it("prints cat output for the most recent events in main()", () => {
    const output = captureConsole();
    const ctxPath = resolve(testRoot, "ctx.jsonl");
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({
          ts: "20260519-100000",
          correlation_id: "cid-1",
          skill: "think",
          domain: "fullstack",
          status: "started",
        }),
        JSON.stringify({
          ts: "20260519-100100",
          correlation_id: "cid-2",
          skill: "dev",
          domain: "fullstack",
          status: "done",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    process.argv = ["node", "cli.js", "cat", "--file", "ctx.jsonl", "--recent", "1"];

    main();

    expect(output.output).toContain(`ctx: ${ctxPath}`);
    expect(output.output).toContain("skill mapping: standard delivery flow");
    expect(output.output).toContain("cid-2");
    expect(output.output).not.toContain("cid-1");
  });
});
