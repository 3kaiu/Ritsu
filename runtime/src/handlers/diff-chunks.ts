import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { runGit } from "./_git-utils.js";

export interface DiffChunk {
  file: string;
  hunkHeader: string;
  content: string;
  riskScore: number;
  riskFactors: string[];
}

function analyzeRisk(file: string, lines: string[]): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];
  const content = lines.join("\n");

  // 1. Shared Types (High risk if changed)
  if (file.includes("types") || file.includes("interfaces") || file.endsWith(".d.ts")) {
    score += 3;
    factors.push("shared_types_file");
  } else if (/(?:export\s+)?(?:interface|type)\s+\w+/.test(content)) {
    score += 2;
    factors.push("type_definition_change");
  }

  // 2. SQL / Database
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|JOIN|DROP|ALTER|CREATE)\b/i.test(content) && !file.includes(".md")) {
    score += 3;
    factors.push("sql_query");
  }

  // 3. Auth / Security
  if (/(?:auth|login|token|password|session|jwt|crypt|hash)/i.test(file) || 
      /(?:verify|authenticate|authorize|sign|encrypt)/i.test(content)) {
    score += 4;
    factors.push("auth_security");
  }

  // 4. API Signatures
  if (/(?:export\s+(?:function|const|class)\s+\w+|app\.(?:get|post|put|delete|use|patch))/.test(content)) {
    score += 2;
    factors.push("api_signature");
  }

  return { score, factors };
}

function parseChunks(diffOutput: string): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let currentFile = "";
  let currentHunkHeader = "";
  let currentLines: string[] = [];

  const flushChunk = () => {
    if (currentFile && currentHunkHeader && currentLines.length > 0) {
      const addedLines = currentLines.filter(l => l.startsWith("+") && !l.startsWith("+++"));
      const { score, factors } = analyzeRisk(currentFile, addedLines);
      
      chunks.push({
        file: currentFile,
        hunkHeader: currentHunkHeader,
        content: currentLines.join("\n"),
        riskScore: score,
        riskFactors: factors,
      });
    }
  };

  const lines = diffOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flushChunk();
      currentFile = "";
      currentHunkHeader = "";
      currentLines = [];
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6);
    } else if (line.startsWith("@@ ")) {
      flushChunk();
      currentHunkHeader = line;
      currentLines = [];
    } else if (currentFile && currentHunkHeader) {
      currentLines.push(line);
    }
  }
  flushChunk(); // flush the last one

  return chunks;
}

export async function ritsu_diff_chunks(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cached = params.cached === true;
  
  const patchArgs = cached
    ? ["diff", "--unified=3", "--cached"]
    : ["diff", "--unified=3"];
    
  const patchR = await runGit(patchArgs, root);
  if (!patchR.ok) return errorResult(`git diff failed: ${patchR.output}`);

  const chunks = parseChunks(patchR.output);
  
  // Sort by risk descending
  chunks.sort((a, b) => b.riskScore - a.riskScore);

  return textResult(JSON.stringify({
    total_chunks: chunks.length,
    chunks: chunks,
  }));
}
