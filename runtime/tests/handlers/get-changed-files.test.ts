import { describe, it, expect, beforeEach, vi } from "vitest";
import { ritsu_get_changed_files } from "../../src/handlers/diff-analyzer.js";
import * as gitUtils from "../../src/handlers/_git-utils.js";

vi.mock("../../src/handlers/_git-utils.js");

describe("ritsu_get_changed_files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identifies staged and unstaged files", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
      if (args.includes("--cached")) {
        return { ok: true, output: "M  src/main.ts\nA  README.md" };
      }
      return { ok: true, output: "M  package.json" };
    });

    const result = await ritsu_get_changed_files({ staged: true, unstaged: true });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.total).toBe(3);
    expect(data.files.map((f: any) => f.path)).toContain("src/main.ts");
    expect(data.files.map((f: any) => f.path)).toContain("package.json");
  });

  it("de-duplicates files across staged and unstaged results and keeps spaced paths", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
      if (args.includes("--cached")) {
        return { ok: true, output: "M  src/main.ts\nA  docs/My File.tsx" };
      }
      return { ok: true, output: "M  src/main.ts\nM  docs/My File.tsx" };
    });

    const result = await ritsu_get_changed_files({ staged: true, unstaged: true });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.total).toBe(2);
    expect(data.files).toEqual([
      expect.objectContaining({ path: "src/main.ts", extension: ".ts" }),
      expect.objectContaining({ path: "docs/My File.tsx", extension: ".tsx" }),
    ]);
  });

  it("infers domain correctly (frontend)", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
      if (args.includes("--cached")) {
        return { ok: true, output: "M  src/App.tsx\nM  src/style.css" };
      }
      return { ok: true, output: "" };
    });

    const result = await ritsu_get_changed_files({ staged: true });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.domain_hint).toBe("frontend");
  });

  it("infers domain correctly (backend)", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
      if (args.includes("--cached")) {
        return { ok: true, output: "M  main.go\nM  handler_test.go" };
      }
      return { ok: true, output: "" };
    });

    const result = await ritsu_get_changed_files({ staged: true });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.domain_hint).toBe("backend");
  });

  it("infers domain correctly (fullstack)", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
      if (args.includes("--cached")) {
        return { ok: true, output: "M  src/App.tsx\nM  api/server.py" };
      }
      return { ok: true, output: "" };
    });

    const result = await ritsu_get_changed_files({ staged: true });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.domain_hint).toBe("fullstack");
  });

  it("returns unknown when no domain-specific suffixes are present", async () => {
    vi.mocked(gitUtils.runGit).mockImplementation(async () => {
      return { ok: true, output: "M  package.json\nA  README.md" };
    });

    const result = await ritsu_get_changed_files({ staged: false, unstaged: true });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.domain_hint).toBe("unknown");
  });

  it("returns an error when unstaged git diff fails", async () => {
    vi.mocked(gitUtils.runGit).mockResolvedValue({ ok: false, output: "fatal: diff failed" });

    const result = await ritsu_get_changed_files({ staged: false, unstaged: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("git diff failed: fatal: diff failed");
  });

  it("returns an error when staged git diff fails", async () => {
    vi.mocked(gitUtils.runGit)
      .mockResolvedValueOnce({ ok: true, output: "M  src/main.ts" })
      .mockResolvedValueOnce({ ok: false, output: "fatal: cached diff failed" });

    const result = await ritsu_get_changed_files({ staged: true, unstaged: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "git diff --cached failed: fatal: cached diff failed",
    );
  });

  it("skips git calls when both staged and unstaged checks are disabled", async () => {
    const result = await ritsu_get_changed_files({ staged: false, unstaged: false });
    const data = JSON.parse(result.content[0].text as string);

    expect(data).toEqual({
      files: [],
      total: 0,
      domain_hint: "unknown",
    });
    expect(gitUtils.runGit).not.toHaveBeenCalled();
  });
});
