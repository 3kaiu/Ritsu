import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult } from "./_utils.js";
import { readAllEntries } from "../ctx-reader.js";

const CLAIMS_FILE = ".ritsu/task-claims.json";

interface TaskClaim {
  span_id: string;
  agent_id: string;
  claimed_at: string;
}

function getClaims(root: string): TaskClaim[] {
  const path = resolve(root, CLAIMS_FILE);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch { return []; }
}

function saveClaims(root: string, claims: TaskClaim[]) {
  const path = resolve(root, CLAIMS_FILE);
  writeFileSync(path, JSON.stringify(claims, null, 2));
}

export async function ritsu_list_pending_tasks(_params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  const entries = readAllEntries(root);
  console.log(`Debug: ritsuDir=${ritsuDir}`);
  if (!existsSync(ritsuDir)) return textResult(JSON.stringify({ tasks: [] }));
  const allFiles = readdirSync(ritsuDir);
  console.log(`Debug: allFiles=${allFiles.join(",")}`);
  const sheets = allFiles.filter(f => f.includes("coordination-sheet"));
  const claims = getClaims(root);
  const pendingTasks: any[] = [];
  
  for (const sheet of sheets) {
    const content = readFileSync(resolve(ritsuDir, sheet), "utf-8");
    const spanMatches = [...content.matchAll(/\| (span-[0-9a-f-]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g)];
    console.log(`Debug: Found ${spanMatches.length} matches in ${sheet}`);
    
    for (const match of spanMatches) {
      const spanId = match[1];
      const role = match[2].trim();
      const desc = match[3].trim();
      const priority = match[4].trim();
      
      // Check if done
      const isDone = entries.some(e => e.span_id === spanId && (e.status === "done" || e.status === "failed"));
      if (isDone) continue;
      
      // Check if claimed
      const claim = claims.find(c => c.span_id === spanId);
      
      pendingTasks.push({
        span_id: spanId,
        role,
        description: desc,
        priority,
        source: sheet,
        claimed_by: claim ? claim.agent_id : null
      });
    }
  }
  
  return textResult(JSON.stringify({ tasks: pendingTasks }));
}

export async function ritsu_claim_task(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const spanId = String(params.span_id);
  const agentId = String(params.agent_id);
  
  const claims = getClaims(root);
  const existing = claims.find(c => c.span_id === spanId);
  
  if (existing && existing.agent_id !== agentId) {
    return textResult(JSON.stringify({
      ok: false,
      message: `Task ${spanId} already claimed by agent ${existing.agent_id}`
    }));
  }

  if (!existing) {
    claims.push({
      span_id: spanId,
      agent_id: agentId,
      claimed_at: new Date().toISOString()
    });
    saveClaims(root, claims);
  }

  return textResult(JSON.stringify({ ok: true, message: `Task ${spanId} claimed by ${agentId}` }));
}
