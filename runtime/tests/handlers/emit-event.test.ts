import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ritsu_emit_event } from "../../src/handlers/emit-event.js";
import { getCtxPath, ensureCtxFile } from "../../src/ctx-path.js";
import * as gitUtils from "../../src/handlers/_git-utils.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/handlers/_git-utils.js");

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

describe("ritsu_emit_event", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-emit-event-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    vi.clearAllMocks();
    mockNoGitWorktree();
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should emit a started event with step", async () => {
    const params = {
      event_type: "started",
      skill: "think",
      domain: "frontend",
      step: "1/4",
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBeUndefined();
    
    const data = JSON.parse(result.content[0].text);
    expect(data.written).toBe(true);
    expect(data.correlation_id).toBeDefined();

    const ctxPath = getCtxPath(testRoot);
    const content = readFileSync(ctxPath, "utf-8").trim();
    const event = JSON.parse(content);
    expect(event.status).toBe("started");
    expect(event.step).toBe("1/4");
    expect(event.correlation_id).toBe(data.correlation_id);
  });

  it("should validate events with correlation_id", async () => {
    // Missing step for started event
    const params = {
      event_type: "started",
      correlation_id: "cid-20260515-999",
      skill: "think",
      domain: "frontend",
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("validation failed");
  });

  it("should reject invalid events before writing when correlation_id is omitted", async () => {
    const params = {
      event_type: "started",
      skill: "augment",
      domain: "fullstack",
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBe(true);

    const ctxPath = getCtxPath(testRoot);
    expect(readFileSync(ctxPath, "utf-8")).toBe("");
  });

  it("should handle artifact_written event", async () => {
    const params = {
      event_type: "artifact_written",
      skill: "dev",
      domain: "fullstack",
      artifact: ".ritsu/dev-report-test.md",
      artifact_meta: {
        type: "dev-report",
        size_bytes: 1024,
        summary: "test report"
      }
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBeUndefined();

    const ctxPath = getCtxPath(testRoot);
    const lastLine = readFileSync(ctxPath, "utf-8").trim().split("\n").pop()!;
    const event = JSON.parse(lastLine);
    expect(event.status).toBe("artifact_written");
    expect(event.artifact_meta.canonical_type).toBe("dev-report");
  });

  it("should handle violation_detected events", async () => {
    const result = await ritsu_emit_event({
      event_type: "violation_detected",
      violation: {
        rule_id: "HC-2",
        severity: "hard_stop",
        evidence: "placeholder found",
        blocked: true,
      },
    });

    expect(result.isError).toBeUndefined();
    const ctxPath = getCtxPath(testRoot);
    const lastLine = readFileSync(ctxPath, "utf-8").trim().split("\n").pop()!;
    const event = JSON.parse(lastLine);
    expect(event.status).toBe("violation_detected");
    expect(event.violation.rule_id).toBe("HC-2");
  });

  it("blocks dev done events when no quality gate snapshot exists", async () => {
    const result = await ritsu_emit_event({
      event_type: "done",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("quality gates must be run");

    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8")
      .trim()
      .split("\n");
    expect(ctxLines).toHaveLength(1);
    const violation = JSON.parse(ctxLines[0]);
    expect(violation.status).toBe("violation_detected");
    expect(violation.violation.rule_id).toBe("AP-5");
  });

  it("blocks dev done events when the latest quality gate did not pass", async () => {
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        status: "failed",
        passed: false,
        recorded_at: "20260519-100000",
        lint: { status: "passed", output: "lint ok" },
        test: {
          status: "failed",
          failures: [{ suite: "tests/main.test.ts" }],
          output: "FAIL tests/main.test.ts",
        },
      }),
      "utf-8",
    );

    const result = await ritsu_emit_event({
      event_type: "done",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("current status: failed");
  });

  it("blocks dev done events when the latest quality gate snapshot belongs to another trace/span", async () => {
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        status: "passed",
        passed: true,
        recorded_at: "20260519-100000",
        context: {
          trace_id: "trace-20260519-0000000000000001",
          span_id: "span-root1111",
          skill: "dev",
          domain: "fullstack",
        },
        lint: { status: "passed", output: "lint ok" },
        test: { status: "passed", failures: [], output: "test ok" },
      }),
      "utf-8",
    );

    const result = await ritsu_emit_event({
      event_type: "done",
      trace_id: "trace-20260519-0000000000000002",
      span_id: "span-root2222",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("different span");
  });

  it("blocks dev done events when tracked changes differ from the quality gate worktree snapshot", async () => {
    mockGitWorktreeState({
      head: "deadbeef",
      stagedFiles: ["src/main.ts"],
      stagedPatch: "changed after quality gates",
    });
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        status: "passed",
        passed: true,
        recorded_at: "20260519-100000",
        context: {
          trace_id: "trace-20260519-0000000000000009",
          span_id: "span-deadbeef",
          skill: "dev",
          domain: "fullstack",
        },
        worktree: buildWorktreeSnapshot({
          head: "deadbeef",
          stagedFiles: ["src/main.ts"],
          stagedPatch: "before new edits",
        }),
        lint: { status: "passed", output: "lint ok" },
        test: { status: "passed", failures: [], output: "test ok" },
      }),
      "utf-8",
    );

    const result = await ritsu_emit_event({
      event_type: "done",
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("staged changes differ");
  });

  it("allows dev done events when the latest quality gate passed", async () => {
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        status: "passed",
        passed: true,
        recorded_at: "20260519-100000",
        lint: { status: "passed", output: "lint ok" },
        test: { status: "passed", failures: [], output: "test ok" },
      }),
      "utf-8",
    );

    const result = await ritsu_emit_event({
      event_type: "done",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBeUndefined();
    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8")
      .trim()
      .split("\n");
    expect(ctxLines).toHaveLength(1);
    const event = JSON.parse(ctxLines[0]);
    expect(event.status).toBe("done");
    expect(event.skill).toBe("dev");
  });

  it("allows dev done events when the latest quality gate snapshot matches the current trace/span", async () => {
    mockGitWorktreeState({
      head: "deadbeef",
      unstagedFiles: ["src/main.ts"],
      unstagedPatch: "stable working tree",
    });
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      resolve(testRoot, ".ritsu/last-quality-gate.json"),
      JSON.stringify({
        status: "passed",
        passed: true,
        recorded_at: "20260519-100000",
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
      }),
      "utf-8",
    );

    const result = await ritsu_emit_event({
      event_type: "done",
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
      step: "5/5",
    });

    expect(result.isError).toBeUndefined();
  });
});
