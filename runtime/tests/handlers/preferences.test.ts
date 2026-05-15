import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ritsu_read_preferences, ritsu_write_preference } from "../../src/handlers/preferences.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

describe("preferences handlers", () => {
  const root = resolve("./test-root-prefs");

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = root;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const ritsuDir = resolve(root, ".ritsu");
    if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads empty preferences if file doesn't exist", async () => {
    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);
    expect(data.rules).toHaveLength(0);
  });

  it("writes and reads preferences correctly", async () => {
    await ritsu_write_preference({
      rule: {
        pattern: "Use functional components",
        scope: "coding_style",
        confidence: 0.9
      }
    });

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);
    expect(data.rules).toHaveLength(1);
    expect(data.rules[0].pattern).toBe("Use functional components");
  });

  it("fails validation with invalid scope", async () => {
    const result = await ritsu_write_preference({
      rule: {
        pattern: "Invalid",
        scope: "invalid_scope"
      }
    });
    expect(result.isError).toBe(true);
  });
});
