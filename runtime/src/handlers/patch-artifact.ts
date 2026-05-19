import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { appendEvent } from "../ctx-writer.js";
import { ts } from "./_utils.js";

export async function ritsu_patch_artifact(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filename = String(params.filename ?? "");
  const targetContent = String(params.target_content ?? "");
  const replacementContent = String(params.replacement_content ?? "");

  if (!filename || !targetContent) {
    return errorResult("filename and target_content are required");
  }

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return errorResult("filename must not contain path traversal (..) or directory separators");
  }

  const filePath = resolve(root, ".ritsu", filename);

  if (!existsSync(filePath)) {
    return errorResult(`file not found: ${filename}`);
  }

  const currentContent = readFileSync(filePath, "utf-8");

  const matchIndex = currentContent.indexOf(targetContent);
  if (matchIndex === -1) {
    return errorResult("target_content not found in the file. Ensure you provide exact matches including whitespace.");
  }

  const firstMatchIndex = currentContent.indexOf(targetContent);
  const lastMatchIndex = currentContent.lastIndexOf(targetContent);

  if (firstMatchIndex !== lastMatchIndex) {
    return errorResult("target_content matches multiple times in the file. Please provide a more specific, unique block of text.");
  }

  const newContent = currentContent.replace(targetContent, replacementContent);
  
  writeFileSync(filePath, newContent, "utf-8");
  const sizeBytes = statSync(filePath).size;

  // Append event for traceability
  await appendEvent(root, {
    ts: ts(),
    status: "artifact_written",
    artifact: filename,
    artifact_meta: {
      type: "patch",
      size_bytes: sizeBytes,
      summary: `Patched ${filename}`,
    },
  });

  return textResult(JSON.stringify({
    path: filePath,
    size_bytes: sizeBytes,
    patched: true
  }));
}
