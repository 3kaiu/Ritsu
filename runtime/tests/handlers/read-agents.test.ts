import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ritsu_read_agents } from "../../src/handlers/read-agents.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

describe("ritsu_read_agents", () => {
  const root = resolve("./test-root-agents");

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = root;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("fails if AGENTS.md is missing", async () => {
    const result = await ritsu_read_agents({});
    expect(result.isError).toBe(true);
  });

  it("parses AGENTS.md correctly", async () => {
    const content = `
# Project Baseline: Ritsu v5.2.0
<!-- Ritsu Configuration Block -->
ritsu-version: 5.2.0
domain: fullstack
tech_fingerprints:
  - nodejs
  - react
<!-- End Ritsu Block -->

规则覆盖:
  rules_overrides:
    disable: [AP-8]
`;
    writeFileSync(resolve(root, "AGENTS.md"), content);

    const result = await ritsu_read_agents({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.ritsu_version).toBe("5.2.0");
    expect(data.domain).toBe("fullstack");
    expect(data.tech_fingerprints).toContain("nodejs");
    expect(data.rules_overrides.disable).toContain("AP-8");
  });
});
