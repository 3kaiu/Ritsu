import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ritsu_sync_openspec_contracts } from "../../src/handlers/sync-openspec-contracts.js";

describe("ritsu_sync_openspec_contracts", () => {
  it("returns error when openspec missing", async () => {
    const root = join(tmpdir(), `ritsu-os-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    process.env.RITSU_PROJECT_ROOT = root;
    const res = await ritsu_sync_openspec_contracts({});
    expect(res.isError).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("syncs contracts from proposal", async () => {
    const root = join(tmpdir(), `ritsu-os-${Date.now()}-ok`);
    const changeDir = join(root, "openspec/changes/demo-feat");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, "proposal.md"),
      "## Requirements\n- Must export metrics endpoint\n",
      "utf-8",
    );
    process.env.RITSU_PROJECT_ROOT = root;

    const res = await ritsu_sync_openspec_contracts({ change_id: "demo-feat" });
    expect(res.isError).not.toBe(true);
    const body = JSON.parse((res.content[0] as { text: string }).text);
    expect(body.change_id).toBe("demo-feat");
    expect(body.contracts.length).toBeGreaterThan(0);
    expect(existsSync(join(root, ".ritsu", "design-sheet-openspec-demo-feat.md"))).toBe(
      true,
    );
    rmSync(root, { recursive: true, force: true });
  });
});
