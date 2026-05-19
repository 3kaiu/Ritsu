import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  bootstrapEcosystem,
  type BootstrapOptions,
  type HostProfile,
} from "../ecosystem-bootstrap.js";
import { getProjectRoot, textResult } from "./_utils.js";

function parseHost(value: unknown): HostProfile | undefined {
  const h = String(value ?? "").toLowerCase();
  if (h === "claude-code" || h === "claude") return "claude-code";
  if (h === "cursor") return "cursor";
  if (h === "all") return "all";
  return undefined;
}

export async function ritsu_bootstrap_ecosystem(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const options: BootstrapOptions = {
    host: parseHost(params.host),
    include_cursor_hooks: params.include_cursor_hooks === true,
  };
  const result = bootstrapEcosystem(root, options);
  return textResult(JSON.stringify(result, null, 2));
}
