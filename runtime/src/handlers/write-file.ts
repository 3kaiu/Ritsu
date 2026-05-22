import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { evaluatePolicies } from "../policy/index.js";
import { emitViolationEvent } from "../violation-events.js";
import { checkLease } from "./file-lease.js";

function findLineForViolation(content: string, v: any): number {
  if (v.evidence) {
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line: string) => line.includes(v.evidence!));
    if (index !== -1) return index + 1;
    // Try matching first 40 characters
    const cleanEvidence = v.evidence.trim().slice(0, 40);
    const index2 = lines.findIndex((line: string) => line.includes(cleanEvidence));
    if (index2 !== -1) return index2 + 1;
  }
  
  if (v.rule_id === "AP-6") {
    const lines = content.split(/\r?\n/);
    const todoIndex = lines.findIndex((line: string) => /\bTODO\b|\bTBD\b|待定|暂不处理|后续完善/.test(line));
    if (todoIndex !== -1) return todoIndex + 1;
  }
  return 1;
}

export async function ritsu_write_file(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const filePathParam = String(params.path ?? "");
  const content = String(params.content ?? "");
  const spanId = String(params.span_id ?? "");

  if (!filePathParam || params.content === undefined) {
    return errorResult("path and content are required fields");
  }

  const root = getProjectRoot();
  const absPath = resolve(root, filePathParam);

  // Path traversal and project boundary defense
  if (!absPath.startsWith(root)) {
    return errorResult(`Path traversal detected: ${filePathParam} is outside project root ${root}`);
  }

  const relativePath = relative(root, absPath);

  // Task Decoupling: allowed target_paths boundaries check
  const claimsPath = resolve(root, ".ritsu/task-claims.json");
  if (existsSync(claimsPath)) {
    try {
      const claims = JSON.parse(readFileSync(claimsPath, "utf-8"));
      if (spanId) {
        const claim = claims.find((c: any) => c.span_id === spanId);
        if (claim && Array.isArray(claim.target_paths) && claim.target_paths.length > 0) {
          const isAllowed = claim.target_paths.some((allowed: string) => {
            const absAllowed = resolve(root, allowed);
            return absPath === absAllowed || absPath.startsWith(absAllowed + "/");
          });
          if (!isAllowed) {
            return {
              content: [{
                type: "text",
                text: `❌ [Linter Error] ${relativePath}:1:1: error - [AP-4] Out of bounds write. File ${relativePath} is not in your allowed target_paths: ${claim.target_paths.join(", ")}. Suggestion: Request path expansion or coordinate task assignment.`
              }],
              isError: true,
            };
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Active lock lease check
  const leaseStatus = checkLease(root, relativePath, spanId || undefined);
  if (!leaseStatus.ok) {
    const holder = leaseStatus.holder_span_id ?? "unknown";
    const ttl = leaseStatus.ttl_remaining_ms ?? 0;
    
    // Check if modifying types dependency
    if (relativePath.includes("types.ts") || relativePath.includes("types")) {
      const currentContent = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "";
      const mergeProposalContent = [
        `// <<< Ritsu Merge Proposal: Conflict detected on common dependency ${relativePath} >>>`,
        `// Current lock holder: ${holder} (Expires in ${ttl}ms)`,
        `// Please coordinate and manually merge the changes.`,
        ``,
        `<<<<<<< CURRENT (Held by ${holder})`,
        currentContent,
        `=======`,
        content,
        `>>>>>>> INCOMING (Requested by ${spanId || "unknown"})`
      ].join("\n");

      try {
        const proposalDir = resolve(root, ".ritsu");
        if (!existsSync(proposalDir)) mkdirSync(proposalDir, { recursive: true });
        writeFileSync(resolve(proposalDir, "merge_proposal.ts"), mergeProposalContent, "utf-8");
      } catch { /* ignore */ }

      return {
        content: [{
          type: "text",
          text: `❌ [Linter Error] ${relativePath}:1:1: error - [Merge Proposal] Concurrent modification detected on common dependency ${relativePath}. A Merge Proposal has been generated at .ritsu/merge_proposal.ts. Suggestion: Coordinate with the holder of span ${holder} and manually merge the changes.`
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text",
        text: `❌ [Linter Error] ${relativePath}:1:1: error - [Lease Lock] File ${relativePath} is locked by active span ${holder}. TTL remaining: ${ttl}ms. Suggestion: Retry after the lease expires or coordinate with the holder.`
      }],
      isError: true,
    };
  }

  // Evaluate Policies
  const policyResult = evaluatePolicies({
    action: "commit_diff", // Evaluates code-level constraints
    target: relativePath,
    content: content,
  });

  if (!policyResult.passed) {
    const failedViolations = policyResult.violations.filter(
      (v) => v.severity === "fatal" || v.severity === "hard_stop" || v.severity === "error"
    );

    if (failedViolations.length > 0) {
      // Emit violation events for the top violation
      const topViolation = failedViolations[0];
      await emitViolationEvent(
        root,
        topViolation.rule_id,
        topViolation.severity,
        topViolation.message,
        topViolation.evidence,
      );

      // Format as standard Linter single-line diagnostic messages to trigger AI self-healing
      const formattedErrors = failedViolations
        .map((v) => {
          const line = findLineForViolation(content, v);
          return `❌ [Linter Error] ${relativePath}:${line}:1: error - [${v.rule_id}] ${v.message}. Suggestion: ${v.suggestion ?? "Please fix the violation."}`;
        })
        .join("\n");

      return {
        content: [{ type: "text", text: formattedErrors }],
        isError: true,
      };
    }
  }

  // Ensure directory exists and write file
  try {
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(absPath, content, "utf-8");
  } catch (err: any) {
    return errorResult(`Failed to write file to ${filePathParam}: ${err.message}`);
  }

  return textResult(JSON.stringify({ success: true, path: absPath }));
}
