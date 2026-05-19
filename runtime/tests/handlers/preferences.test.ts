import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ritsu_read_preferences, ritsu_write_preference } from "../../src/handlers/preferences.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

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
        match_regex: "Use functional components",
        scope: "coding_style",
        confidence: 0.9
      }
    });

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);
    expect(data.rules).toHaveLength(1);
    expect(data.rules[0].match_regex).toBe("Use functional components");
  });

  it("normalizes legacy pattern preferences on write", async () => {
    await ritsu_write_preference({
      rule: {
        pattern: "Prefer hooks",
        scope: "coding_style",
      },
    });

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);
    expect(data.rules[0].match_regex).toBe("Prefer hooks");
  });

  it("writes require_call preferences and preserves trimmed metadata", async () => {
    await ritsu_write_preference({
      rule: {
        id: "pref-call",
        require_call: " React.useMemo ",
        scope: "architecture",
        source: " user ",
        auto_inject_to: ["think", " ", "dev"],
        created_at: "2025-01-02T03:04:05.000Z",
      },
    });

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.rules).toHaveLength(1);
    expect(data.rules[0]).toMatchObject({
      id: "pref-call",
      require_call: "React.useMemo",
      scope: "architecture",
      source: "user",
      auto_inject_to: ["think", "dev"],
      created_at: "2025-01-02T03:04:05.000Z",
    });
  });

  it("fails validation with invalid scope", async () => {
    const result = await ritsu_write_preference({
      rule: {
        match_regex: "Invalid",
        scope: "invalid_scope"
      }
    });
    expect(result.isError).toBe(true);
  });

  it("reads and normalizes stored preferences while dropping invalid rules", async () => {
    writeFileSync(
      resolve(root, ".ritsu/preferences.yaml"),
      [
        "rules:",
        "  - id: pref-pattern",
        "    pattern: Prefer hooks",
        "    scope: coding_style",
        "    auto_inject_to: [dev, '', 1]",
        "  - id: pref-lib",
        "    forbid_lib: axios",
        "    scope: library_choice",
        "  - id: pref-invalid",
        "    scope: architecture",
      ].join("\n"),
      "utf-8",
    );

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.rules).toHaveLength(2);
    expect(data.rules[0]).toMatchObject({
      id: "pref-pattern",
      match_regex: "Prefer hooks",
      scope: "coding_style",
      auto_inject_to: ["dev"],
    });
    expect(data.rules[1]).toMatchObject({
      id: "pref-lib",
      forbid_lib: "axios",
      scope: "library_choice",
    });
  });

  it("reads legacy preferences roots as normalized rules", async () => {
    writeFileSync(
      resolve(root, ".ritsu/preferences.yaml"),
      [
        "preferences:",
        "  - id: pref-legacy",
        "    match_regex: Prefer hooks",
        "    scope: coding_style",
      ].join("\n"),
      "utf-8",
    );

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.rules).toHaveLength(1);
    expect(data.rules[0]).toMatchObject({
      id: "pref-legacy",
      match_regex: "Prefer hooks",
      scope: "coding_style",
    });
  });

  it("returns an error when the preferences file is malformed", async () => {
    writeFileSync(
      resolve(root, ".ritsu/preferences.yaml"),
      "rules: [unterminated",
      "utf-8",
    );

    const result = await ritsu_read_preferences({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to read preferences");
  });

  it("treats scalar yaml documents as empty preference sets", async () => {
    writeFileSync(resolve(root, ".ritsu/preferences.yaml"), "just-a-string", "utf-8");

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data).toEqual({ rules: [] });
  });

  it("de-duplicates by semantic identity and recovers from malformed existing yaml", async () => {
    writeFileSync(
      resolve(root, ".ritsu/preferences.yaml"),
      "rules: [unterminated",
      "utf-8",
    );

    await ritsu_write_preference({
      rule: {
        match_regex: "Prefer hooks",
        scope: "coding_style",
        confidence: 0.6,
        source: " user ",
        auto_inject_to: ["dev", " ", 7, "review"],
      },
    });
    await ritsu_write_preference({
      rule: {
        match_regex: "Prefer hooks",
        scope: "coding_style",
        confidence: 0.95,
        source: " cleaned ",
        auto_inject_to: ["dev", "review"],
      },
    });

    const result = await ritsu_read_preferences({});
    const data = JSON.parse(result.content[0].text as string);

    expect(data.rules).toHaveLength(1);
    expect(data.rules[0]).toMatchObject({
      id: "pref-2",
      match_regex: "Prefer hooks",
      source: "cleaned",
      confidence: 0.95,
      auto_inject_to: ["dev", "review"],
    });
    expect(readFileSync(resolve(root, ".ritsu/preferences.yaml"), "utf-8")).toContain(
      "Prefer hooks",
    );
  });

  it("fails validation when no matcher is present or confidence is out of range", async () => {
    const missingMatcher = await ritsu_write_preference({
      rule: {
        scope: "coding_style",
      },
    });
    const invalidConfidence = await ritsu_write_preference({
      rule: {
        match_regex: "Prefer hooks",
        scope: "coding_style",
        confidence: 1.5,
      },
    });

    expect(missingMatcher.isError).toBe(true);
    expect(missingMatcher.content[0].text).toContain("Rule with 'scope'");
    expect(invalidConfidence.isError).toBe(true);
    expect(invalidConfidence.content[0].text).toContain(
      "Confidence must be between 0 and 1",
    );
  });

  it("surfaces non-Error yaml read failures", async () => {
    writeFileSync(resolve(root, ".ritsu/preferences.yaml"), "rules: []", "utf-8");
    const loadSpy = vi.spyOn(yaml, "load").mockImplementation(() => {
      throw "yaml read boom";
    });

    try {
      const result = await ritsu_read_preferences({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("yaml read boom");
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("returns write errors when yaml serialization fails", async () => {
    const dumpSpy = vi.spyOn(yaml, "dump").mockImplementation(() => {
      throw "yaml write boom";
    });

    try {
      const result = await ritsu_write_preference({
        rule: {
          match_regex: "Prefer hooks",
          scope: "coding_style",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("yaml write boom");
    } finally {
      dumpSpy.mockRestore();
    }
  });
});
