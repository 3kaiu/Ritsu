import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ARTIFACT_LAYER_MAP, ARTIFACT_PREFIX_MAP } from "../shared.js";
import { getProjectRoot, textResult, warnResult } from "./_utils.js";

const RITSU_DIR = ".ritsu";

export async function ritsu_list_artifacts(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const type = String(params.type ?? "all");
  const root = getProjectRoot();
  const dir = resolve(root, RITSU_DIR);

  if (!existsSync(dir))
    return warnResult(
      { files: [], total_count: 0 },
      ".ritsu directory does not exist yet",
    );

  const prefix = type === "all" ? "" : (ARTIFACT_PREFIX_MAP[type] ?? "");
  const entries = readdirSync(dir)
    .map((f: string) => ({ name: f, stat: statSync(resolve(dir, f)) }))
    .filter(({ stat }) => stat.isFile())
    .filter(({ name }) => (prefix ? name.startsWith(prefix) : true))
    .map(({ name, stat }) => {
      const artifactType =
        Object.entries(ARTIFACT_PREFIX_MAP).find(([, p]: [string, string]) =>
          name.startsWith(p),
        )?.[0] ?? "unknown";

      return {
        path: resolve(dir, name),
        modified: stat.mtime.toISOString().replace(/[-:T]/g, "").slice(0, 15),
        size_bytes: stat.size,
        artifact_type: artifactType,
        artifact_layer: ARTIFACT_LAYER_MAP[artifactType] ?? "system",
      };
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(b.modified).localeCompare(String(a.modified)),
    );

  return textResult(
    JSON.stringify({ files: entries, total_count: entries.length }),
  );
}
