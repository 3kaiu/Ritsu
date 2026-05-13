import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  getArtifactLayer,
  detectArtifactTypeFromFileName,
  getCanonicalArtifactType,
  getPreferredArtifactType,
  getArtifactPrefixesForType,
} from "../shared.js";
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

  const prefixes = getArtifactPrefixesForType(type);
  const entries = readdirSync(dir)
    .map((f: string) => ({ name: f, stat: statSync(resolve(dir, f)) }))
    .filter(({ stat }) => stat.isFile())
    .filter(({ name }) =>
      prefixes.length > 0
        ? prefixes.some((prefix) => name.startsWith(prefix))
        : true,
    )
    .map(({ name, stat }) => {
      const artifactType = detectArtifactTypeFromFileName(name) ?? "unknown";
      const canonicalType = getCanonicalArtifactType(artifactType);
      const preferredType = getPreferredArtifactType(artifactType);

      return {
        path: resolve(dir, name),
        modified: stat.mtime.toISOString().replace(/[-:T]/g, "").slice(0, 15),
        size_bytes: stat.size,
        artifact_type: preferredType,
        canonical_type: canonicalType,
        detected_type: artifactType,
        artifact_layer: getArtifactLayer(artifactType),
      };
    })
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(b.modified).localeCompare(String(a.modified)),
    );

  return textResult(
    JSON.stringify({ files: entries, total_count: entries.length }),
  );
}
