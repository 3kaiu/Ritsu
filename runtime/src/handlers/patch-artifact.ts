import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, errorResult, jsonErrorResult } from "./_utils.js";
import { appendEvent } from "../ctx-writer.js";
import { ts } from "./_utils.js";
import { detectArtifactTypeFromFileName } from "../shared.js";
import { evaluatePolicies } from "../policy/index.js";
import { emitViolationEvent } from "../violation-events.js";

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
  
  // Enforce Policy Engine Checks on the patched content
  const skill = params.skill ?? (params.context && typeof params.context === "object" && !Array.isArray(params.context) ? (params.context as Record<string, unknown>).skill : undefined);
  const policyResult = evaluatePolicies({
    action: "write_artifact",
    target: filename,
    content: newContent,
    context: typeof skill === "string" ? { skill } : undefined,
  });

  if (!policyResult.passed) {
    const topViolation = policyResult.violations.find((v) => v.severity === "fatal" || v.severity === "hard_stop") || policyResult.violations[0];
    
    await emitViolationEvent(
      root,
      topViolation.rule_id,
      topViolation.severity,
      topViolation.message,
      topViolation.evidence,
    );

    const artifactType = detectArtifactTypeFromFileName(filename) || undefined;
    return jsonErrorResult({
      error: {
        type: "ArtifactWriteError",
        message: "patch rejected by policy engine",
        violations: policyResult.violations
          .filter((v) => v.severity === "fatal" || v.severity === "hard_stop")
          .map((v) => ({
            code: "policy_violation",
            severity: "error",
            path: "content",
            message: `[${v.rule_id}] ${v.message}`,
            artifact_type: artifactType,
            expected: [v.suggestion ?? "Comply with policy"],
            actual: [v.evidence ?? "Policy violation"],
          })),
      }
    });
  }

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
