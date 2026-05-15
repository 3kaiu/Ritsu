import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ritsu_run_quality_gates } from "../../src/handlers/run-quality-gates.js";
import { existsSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as child_process from "node:child_process";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

vi.mock("node:child_process");

describe("ritsu_run_quality_gates", () => {
  const root = resolve("./test-root-qg");

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = root;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function mockSpawn(code: number, stdout: string, stderr: string) {
    const cp = new EventEmitter() as any;
    cp.stdout = Readable.from([stdout]);
    cp.stderr = Readable.from([stderr]);
    cp.kill = vi.fn();
    
    vi.mocked(child_process.spawn).mockImplementation(() => {
      setTimeout(() => {
        cp.emit("close", code);
      }, 50);
      return cp;
    });
  }

  it("reports success when lint and test pass", async () => {
    writeFileSync(resolve(root, "package.json"), JSON.stringify({
      scripts: { lint: "eslint", test: "vitest" }
    }));

    mockSpawn(0, "All tests passed", "");

    const result = await ritsu_run_quality_gates({ timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(true);
    expect(data.status).toBe("passed");
  }, 10000);

  it("reports failure when tests fail", async () => {
    writeFileSync(resolve(root, "package.json"), JSON.stringify({
      scripts: { test: "vitest" }
    }));

    mockSpawn(1, "FAIL tests/main.test.ts\n✕ should work", "Error: failed");

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(false);
    expect(data.test.status).toBe("failed");
    expect(data.test.failures).toHaveLength(1);
    expect(data.test.failures[0].suite).toContain("tests/main.test.ts");
  }, 10000);
});
