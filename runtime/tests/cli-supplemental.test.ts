import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatEvent,
  findLatestCtxFile,
  getLatestTraceId,
  getOpenTraceIds,
  main,
  normalizeTraceId,
  parseJsonl,
  readCoveragePct,
  readRuntimeMetadataFromPackageJson,
  runDoctor,
  runDoctorHealth,
  runExport,
  runTrace,
} from "../src/cli.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

describe("cli supplemental coverage", () => {
  let testRoot: string;
  let originalArgv: string[];
  let originalProjectRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-cli-supplemental-"));
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

  it("returns null or default values for missing ctx and malformed metadata files", () => {
    expect(findLatestCtxFile(testRoot)).toBeNull();

    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    writeFileSync(resolve(ritsuDir, "notes.txt"), "x", "utf-8");
    expect(findLatestCtxFile(testRoot)).toBeNull();
    expect(readCoveragePct(testRoot)).toBe("0.0");

    writeFileSync(resolve(ritsuDir, "last-quality-gate.json"), "{bad", "utf-8");
    expect(readCoveragePct(testRoot)).toBe("0.0");

    const pkgPath = resolve(testRoot, "package.json");
    writeFileSync(pkgPath, "{bad", "utf-8");
    expect(readRuntimeMetadataFromPackageJson(pkgPath)).toEqual({
      packageVersion: null,
      protocolVersion: null,
    });

    writeFileSync(pkgPath, JSON.stringify("not-an-object"), "utf-8");
    expect(readRuntimeMetadataFromPackageJson(pkgPath)).toEqual({
      packageVersion: null,
      protocolVersion: null,
    });
    expect(getLatestTraceId([])).toBeNull();
  });


  it("reports missing context in health mode", async () => {
    const output = captureConsole();

    await runDoctorHealth();

    expect(output.output).toContain("Ritsu Health Dashboard");
    expect(output.output).toContain("No context file found");
  });

  it("reports missing AGENTS, .ritsu, and ctx files in doctor mode", async () => {
    const output = captureConsole();
    mockProcessExit();

    await expect(runDoctor()).rejects.toThrow("process.exit:1");

    expect(output.output).toContain("AGENTS.md missing in root");
    expect(output.output).toContain(".ritsu/ directory missing");
    expect(output.output).toContain("No context (jsonl) file found for this month");
    expect(output.output).toContain("Summary: 1 Errors, 2 Warnings");
  });

  it("reports ctx parse failures in doctor mode", async () => {
    const output = captureConsole();
    mockProcessExit();
    writeFileSync(
      resolve(testRoot, "AGENTS.md"),
      ["ritsu-version: 6.5.0", "domain: fullstack"].join("\n"),
      "utf-8",
    );
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(resolve(ritsuDir, "ctx-2026-05.jsonl"), { recursive: true });

    await expect(runDoctor()).rejects.toThrow("process.exit:1");

    expect(output.output).toContain("Failed to parse ctx file");
    expect(output.output).toContain("Summary: 1 Errors, 0 Warnings");
  });

  it("exits export when no context file exists", async () => {
    captureConsole();
    mockProcessExit();

    await expect(runExport(null)).rejects.toThrow("process.exit:1");
  });

  it("prints markdown export to stdout when no output path is provided", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "dev",
        domain: "backend",
        status: "failed",
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-2",
        skill: "review",
        domain: "frontend",
        status: "started",
      },
    ]);

    await runExport(null);

    expect(output.output).toContain("# Ritsu Task Export");
    expect(output.output).toContain("❌ failed");
    expect(output.output).toContain("⏳ in_progress");
  });

  it("exits trace when no context file exists", async () => {
    captureConsole();
    mockProcessExit();

    await expect(runTrace("trace-missing")).rejects.toThrow("process.exit:1");
  });

  it("fails triple verification when latest trace is incomplete", async () => {
    const output = captureConsole();
    mockProcessExit();
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
    ]);

    await expect(runTrace(null, false, true)).rejects.toThrow("process.exit:1");

    expect(output.output).toContain("Triple Verification Failed");
  });

  it("fails triple verification when the latest context has no trace ids", async () => {
    const output = captureConsole();
    mockProcessExit();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await expect(runTrace(null, false, true)).rejects.toThrow("process.exit:1");

    expect(output.output).toContain("No traces found in the latest context file.");
  });

  it("covers trace-only correlation backfill and extra formatting branches", () => {
    const ctxPath = resolve(testRoot, "trace-only.jsonl");
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({
          ts: "2026-05-19T10:00:00.000Z",
          correlation_id: "trace-20260519-0000000000000009",
          skill: "think",
          domain: "fullstack",
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:01:00.000Z",
          correlation_id: "cid-invalid",
          skill: "dev",
          domain: "backend",
          status: "failed",
          error: "boom",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:02:00.000Z",
          correlation_id: "cid-3",
          skill: "review",
          domain: "fullstack",
          status: "violation_detected",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const events = parseJsonl(ctxPath);

    expect(events[0]).toMatchObject({
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-00000000",
    });
    expect(stripAnsi(formatEvent(events[0]))).toContain("started");
    expect(stripAnsi(formatEvent(events[1]))).toContain("error:boom");
    expect(stripAnsi(formatEvent(events[2]))).toContain("violation_detected");
    expect(normalizeTraceId("cid-invalid")).toBe("cid-invalid");
    expect(getOpenTraceIds(events)).toEqual(["trace-20260519-0000000000000009"]);
  });

  it("prints no-open-traces and trace-not-found branches", async () => {
    const output = captureConsole();
    mockProcessExit();
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
    ]);

    await runTrace(null, true, false);
    expect(output.output).toContain("No open traces found.");

    await expect(runTrace("trace-missing")).rejects.toThrow("process.exit:2");
    expect(output.output).toContain("Trace not found: trace-missing");
  });

  it("covers missing file and no-match cat branches in main()", () => {
    const output = captureConsole();
    mockProcessExit();

    process.argv = ["node", "cli.js", "cat"];
    expect(() => main()).toThrow("process.exit:1");
    expect(output.output).toContain("Context file not found");

    const ctxPath = resolve(testRoot, "ctx.jsonl");
    writeFileSync(
      ctxPath,
      JSON.stringify({
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "started",
      }) + "\n",
      "utf-8",
    );

    process.argv = ["node", "cli.js", "cat", "--file", "ctx.jsonl", "cid-404"];
    expect(() => main()).toThrow("process.exit:2");
    expect(output.output).toContain("No matching events found");
  });
});
