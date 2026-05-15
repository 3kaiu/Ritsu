import { describe, it, expect, beforeEach, vi } from "vitest";
import { ritsu_get_changed_files } from "../../src/handlers/get-changed-files.js";
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
});
