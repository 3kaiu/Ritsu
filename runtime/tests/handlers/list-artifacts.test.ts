import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ritsu_list_artifacts } from "../../src/handlers/list-artifacts.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

describe("ritsu_list_artifacts", () => {
  const root = resolve("./test-root-list");

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = root;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const ritsuDir = resolve(root, ".ritsu");
    if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty list if no artifacts exist", async () => {
    const result = await ritsu_list_artifacts({ type: "all" });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.files).toHaveLength(0);
    expect(data.total_count).toBe(0);
  });

  it("returns a warning payload when the .ritsu directory is missing", async () => {
    rmSync(resolve(root, ".ritsu"), { recursive: true, force: true });

    const result = await ritsu_list_artifacts({ type: "all" });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.files).toEqual([]);
    expect(data.total_count).toBe(0);
    expect(data._warning).toBe(".ritsu directory does not exist yet");
  });

  it("lists all artifacts when type is 'all'", async () => {
    const ritsuDir = resolve(root, ".ritsu");
    writeFileSync(resolve(ritsuDir, "design-sheet-1.md"), "content");
    writeFileSync(resolve(ritsuDir, "dev-report-1.md"), "content");

    const result = await ritsu_list_artifacts({ type: "all" });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.total_count).toBe(2);
    expect(data.files.some((f: any) => f.path.includes("design-sheet-1.md"))).toBe(true);
    expect(data.files.some((f: any) => f.path.includes("dev-report-1.md"))).toBe(true);
  });

  it("filters by type", async () => {
    const ritsuDir = resolve(root, ".ritsu");
    writeFileSync(resolve(ritsuDir, "design-sheet-1.md"), "content");
    writeFileSync(resolve(ritsuDir, "dev-report-1.md"), "content");

    const result = await ritsu_list_artifacts({ type: "design-sheet" });
    const data = JSON.parse(result.content[0].text as string);
    expect(data.total_count).toBe(1);
    expect(data.files[0].artifact_type).toBe("design-sheet");
  });
});
