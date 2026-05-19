import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[\d+m/g, "");
}

describe("cli entrypoint", () => {
  let originalArgv: string[];
  let originalProjectRoot: string | undefined;

  beforeEach(() => {
    originalArgv = [...process.argv];
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    delete process.env.RITSU_PROJECT_ROOT;
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    vi.restoreAllMocks();
  });

  it("invokes main when the module is loaded as the entrypoint", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const cliPath = resolve(process.cwd(), "src/cli.ts");
    process.argv = ["node", cliPath, "--help"];

    vi.resetModules();
    await import("../src/cli.js");

    expect(stripAnsi(logs.join("\n"))).toContain("ritsu cat");
  });
});
