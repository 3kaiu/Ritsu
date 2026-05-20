import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult, textResult, warnResult } from "./_utils.js";
import { getAgentsProfile } from "../agents-parser.js";

export async function ritsu_read_agents(
  _params: Record<string, unknown>,
): Promise<CallToolResult> {
  const profile = getAgentsProfile();

  if (!profile) {
    return errorResult("AGENTS.md not found at project root");
  }

  const data = {
    path: profile.path,
    ritsu_version: profile.ritsu_version,
    domain: profile.domain,
    tech_fingerprints: profile.tech_fingerprints,
    rules_overrides: profile.rules_overrides,
  };

  if (!profile.has_ritsu_block) {
    return warnResult(
      data,
      "Ritsu Configuration Block not found; parsed AGENTS.md with best-effort heuristics",
    );
  }

  return textResult(JSON.stringify(data));
}
