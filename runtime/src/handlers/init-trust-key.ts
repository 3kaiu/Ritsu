import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult } from "./_utils.js";
import { initKey, getOrCreateKey } from "../policy/signature.js";

export async function ritsu_init_trust_key(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const force = params.force === true || params.force === "true";
  
  const existing = getOrCreateKey();
  if (existing && !force) {
    return textResult(JSON.stringify({
      ok: false,
      path: ".ritsu/secret.key",
      message: "Trust key already exists. Use force=true to overwrite (CAUTION: invalidates old signatures)."
    }));
  }

  const key = initKey();
  return textResult(JSON.stringify({
    ok: true,
    path: ".ritsu/secret.key",
    message: "Trust key initialized. All future events will be HMAC-signed."
  }));
}
