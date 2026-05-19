import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bootstrapEcosystem,
  checkEcosystem,
} from "../src/ecosystem-bootstrap.js";

describe("ecosystem-bootstrap", () => {
  it("writes .mcp.json by default (claude-code)", () => {
    const root = join(tmpdir(), `ritsu-boot-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeAgents(root);

    const result = bootstrapEcosystem(root);
    expect(result.host_profile).toBe("claude-code");
    expect(existsSync(join(root, ".mcp.json"))).toBe(true);
    expect(existsSync(join(root, ".ritsu/ecosystem.json"))).toBe(true);
    expect(existsSync(join(root, ".cursor/mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".cursor/hooks.json"))).toBe(false);

    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.ritsu).toBeDefined();
    expect(mcp.mcpServers.filesystem).toBeDefined();

    const eco = JSON.parse(readFileSync(join(root, ".ritsu/ecosystem.json"), "utf-8"));
    expect(eco.host_profile).toBe("claude-code");

    rmSync(root, { recursive: true, force: true });
  });

  it("writes cursor mcp when host=all", () => {
    const root = join(tmpdir(), `ritsu-boot-cursor-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeAgents(root);

    bootstrapEcosystem(root, { host: "all" });
    expect(existsSync(join(root, ".mcp.json"))).toBe(true);
    expect(existsSync(join(root, ".cursor/mcp.json"))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it("checkEcosystem fails without .mcp.json", () => {
    const root = join(tmpdir(), `ritsu-chk-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const result = checkEcosystem(root);
    expect(result.passed).toBe(false);
    expect(result.items.some((i) => i.id === "claude-mcp")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

function writeAgents(root: string) {
  writeFileSync(
    join(root, "AGENTS.md"),
    "<!-- Ritsu Configuration Block -->\ndomain: fullstack\n<!-- End -->\n",
    "utf-8",
  );
}
