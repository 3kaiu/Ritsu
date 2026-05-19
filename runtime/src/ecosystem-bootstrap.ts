import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type HostProfile = "claude-code" | "cursor" | "all";

export type EcosystemConfig = {
  version: string;
  profile: string;
  host_profile: HostProfile;
  openspec: "auto" | "off";
  ast_grep: boolean;
  optional_mcp?: {
    context7?: { enabled: boolean; disabled_reason?: string };
  };
};

export type BootstrapOptions = {
  host?: HostProfile;
  include_cursor_hooks?: boolean;
};

export type BootstrapResult = {
  project_root: string;
  host_profile: HostProfile;
  files_written: string[];
  files_merged: string[];
  ecosystem: EcosystemConfig;
  notes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMcpServers(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, val] of Object.entries(incoming)) {
    if (!merged[key]) merged[key] = val;
  }
  return merged;
}

function buildMcpServers(projectRoot: string): Record<string, unknown> {
  const ritsuEntry = existsSync(resolve(projectRoot, "runtime/dist/index.js"))
    ? {
        command: "node",
        args: [resolve(projectRoot, "runtime/dist/index.js")],
        env: { RITSU_PROJECT_ROOT: projectRoot },
      }
    : {
        command: "npx",
        args: ["-y", "ritsu-mcp-server"],
        env: { RITSU_PROJECT_ROOT: projectRoot },
      };

  return {
    ritsu: ritsuEntry,
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", projectRoot],
    },
    git: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-git"],
      env: { GIT_REPO_PATH: projectRoot },
    },
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}",
      },
    },
  };
}

function writeMcpJson(
  mcpPath: string,
  projectRoot: string,
  filesWritten: string[],
  filesMerged: string[],
): void {
  const incoming = { mcpServers: buildMcpServers(projectRoot) };
  if (existsSync(mcpPath)) {
    try {
      const existing = JSON.parse(readFileSync(mcpPath, "utf-8")) as unknown;
      const existingServers =
        isRecord(existing) && isRecord(existing.mcpServers)
          ? (existing.mcpServers as Record<string, unknown>)
          : {};
      const incomingServers = incoming.mcpServers as Record<string, unknown>;
      const merged = isRecord(existing)
        ? {
            ...existing,
            mcpServers: mergeMcpServers(existingServers, incomingServers),
          }
        : { mcpServers: mergeMcpServers(existingServers, incomingServers) };
      writeFileSync(mcpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
      filesMerged.push(mcpPath.replace(projectRoot + "/", ""));
    } catch {
      writeFileSync(mcpPath, JSON.stringify(incoming, null, 2) + "\n", "utf-8");
      filesWritten.push(mcpPath.replace(projectRoot + "/", ""));
    }
  } else {
    writeFileSync(mcpPath, JSON.stringify(incoming, null, 2) + "\n", "utf-8");
    filesWritten.push(mcpPath.replace(projectRoot + "/", ""));
  }
}

function buildCursorHooksConfig(): Record<string, unknown> {
  return {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: "command",
          command:
            "echo '[Ritsu] Ecosystem active. Use /r-route for staged delivery.'",
        },
      ],
      stop: [
        {
          type: "command",
          command:
            "echo '[Ritsu] If you opened a trace span, run ritsu_close_span before ending.'",
        },
      ],
    },
  };
}

function upsertAgentsEcosystemProfile(agentsPath: string): boolean {
  if (!existsSync(agentsPath)) return false;
  const content = readFileSync(agentsPath, "utf-8");
  if (/host_profile:/.test(content)) return false;
  const updated = content.replace(
    /(domain:\s*\S+)/,
    "$1\nhost_profile: claude-code",
  );
  if (updated === content) return false;
  writeFileSync(agentsPath, updated, "utf-8");
  return true;
}

function resolveHostProfile(options?: BootstrapOptions): HostProfile {
  const envHost = process.env.RITSU_HOST?.trim().toLowerCase();
  if (envHost === "cursor" || envHost === "all") return envHost;
  if (envHost === "claude-code" || envHost === "claude") return "claude-code";
  return options?.host ?? "claude-code";
}

export function bootstrapEcosystem(
  projectRoot: string,
  options?: BootstrapOptions,
): BootstrapResult {
  const filesWritten: string[] = [];
  const filesMerged: string[] = [];
  const notes: string[] = [];
  const hostProfile = resolveHostProfile(options);

  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });

  const ecosystem: EcosystemConfig = {
    version: "1",
    profile: "default",
    host_profile: hostProfile,
    openspec: "auto",
    ast_grep: true,
    optional_mcp: {
      context7: {
        enabled: false,
        disabled_reason:
          "Add Context7 to .mcp.json manually — see docs/integrations.md",
      },
    },
  };

  const ecosystemPath = resolve(ritsuDir, "ecosystem.json");
  const ecoExisted = existsSync(ecosystemPath);
  writeFileSync(ecosystemPath, JSON.stringify(ecosystem, null, 2) + "\n", "utf-8");
  if (ecoExisted) filesMerged.push(".ritsu/ecosystem.json");
  else filesWritten.push(".ritsu/ecosystem.json");

  if (hostProfile === "claude-code" || hostProfile === "all") {
    writeMcpJson(
      resolve(projectRoot, ".mcp.json"),
      projectRoot,
      filesWritten,
      filesMerged,
    );
    notes.push("Reload MCP in Claude Code (restart session or /mcp).");
  }

  if (hostProfile === "cursor" || hostProfile === "all") {
    const cursorDir = resolve(projectRoot, ".cursor");
    if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
    writeMcpJson(
      resolve(cursorDir, "mcp.json"),
      projectRoot,
      filesWritten,
      filesMerged,
    );
    if (options?.include_cursor_hooks) {
      const hooksPath = resolve(cursorDir, "hooks.json");
      if (!existsSync(hooksPath)) {
        writeFileSync(
          hooksPath,
          JSON.stringify(buildCursorHooksConfig(), null, 2) + "\n",
          "utf-8",
        );
        filesWritten.push(".cursor/hooks.json");
      }
    } else {
      notes.push("Cursor hooks not written (opt-in: bootstrap --host all with include_cursor_hooks).");
    }
  }

  const agentsPath = resolve(projectRoot, "AGENTS.md");
  if (upsertAgentsEcosystemProfile(agentsPath)) {
    filesMerged.push("AGENTS.md (host_profile)");
  }

  if (!existsSync(resolve(projectRoot, "rules/ast-grep"))) {
    notes.push("rules/ast-grep/ missing — AP-13 inactive until rules present");
  }

  return {
    project_root: projectRoot,
    host_profile: hostProfile,
    files_written: filesWritten,
    files_merged: filesMerged,
    ecosystem,
    notes,
  };
}

export type EcosystemCheckItem = {
  id: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
};

export type EcosystemCheckResult = {
  passed: boolean;
  items: EcosystemCheckItem[];
};

function checkMcpFile(
  mcpPath: string,
  label: string,
  required: boolean,
): EcosystemCheckItem[] {
  const items: EcosystemCheckItem[] = [];
  if (!existsSync(mcpPath)) {
    items.push({
      id: `${label}-mcp`,
      status: required ? "fail" : "warn",
      message: `${label} MCP config missing`,
      fix: required ? "ritsu bootstrap" : undefined,
    });
    return items;
  }
  try {
    const mcp = JSON.parse(readFileSync(mcpPath, "utf-8")) as unknown;
    const servers =
      isRecord(mcp) && isRecord(mcp.mcpServers) ? Object.keys(mcp.mcpServers) : [];
    items.push({
      id: `${label}-mcp-ritsu`,
      status: servers.includes("ritsu") ? "ok" : "fail",
      message: servers.includes("ritsu")
        ? `${label}: ritsu configured`
        : `${label}: ritsu missing`,
      fix: servers.includes("ritsu") ? undefined : "ritsu bootstrap",
    });
    items.push({
      id: `${label}-mcp-filesystem`,
      status: servers.includes("filesystem") ? "ok" : "warn",
      message: servers.includes("filesystem")
        ? `${label}: filesystem configured`
        : `${label}: filesystem optional`,
    });
  } catch {
    items.push({
      id: `${label}-mcp-parse`,
      status: "fail",
      message: `${label} MCP JSON invalid`,
      fix: "Fix JSON or re-run bootstrap",
    });
  }
  return items;
}

export function checkEcosystem(projectRoot: string): EcosystemCheckResult {
  const items: EcosystemCheckItem[] = [];

  items.push(...checkMcpFile(resolve(projectRoot, ".mcp.json"), "claude", true));

  const cursorMcp = resolve(projectRoot, ".cursor/mcp.json");
  if (existsSync(cursorMcp)) {
    items.push(...checkMcpFile(cursorMcp, "cursor", false));
  }

  const ecoPath = resolve(projectRoot, ".ritsu/ecosystem.json");
  items.push({
    id: "ecosystem-json",
    status: existsSync(ecoPath) ? "ok" : "warn",
    message: existsSync(ecoPath)
      ? ".ritsu/ecosystem.json present"
      : ".ritsu/ecosystem.json missing",
    fix: existsSync(ecoPath) ? undefined : "ritsu bootstrap",
  });

  items.push({
    id: "ast-grep-rules",
    status: existsSync(resolve(projectRoot, "rules/ast-grep")) ? "ok" : "warn",
    message: existsSync(resolve(projectRoot, "rules/ast-grep"))
      ? "rules/ast-grep/ present"
      : "rules/ast-grep/ missing",
  });

  items.push({
    id: "openspec-dir",
    status: existsSync(resolve(projectRoot, "openspec")) ? "ok" : "warn",
    message: existsSync(resolve(projectRoot, "openspec"))
      ? "openspec/ present"
      : "openspec/ optional until P2 think",
  });

  try {
    execFileSync("npx", ["--yes", "@ast-grep/cli", "--version"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    items.push({
      id: "ast-grep-cli",
      status: "ok",
      message: "@ast-grep/cli reachable via npx",
    });
  } catch {
    items.push({
      id: "ast-grep-cli",
      status: "warn",
      message: "@ast-grep/cli not reachable",
      fix: "npx --yes @ast-grep/cli --version",
    });
  }

  const passed = !items.some((i) => i.status === "fail");
  return { passed, items };
}

export { RUNTIME_DIR };
