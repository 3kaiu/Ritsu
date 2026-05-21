import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, jsonErrorResult } from "./_utils.js";
import { readAllEntries } from "../ctx-reader.js";
import { readJsonFile, updateLockedJsonFile } from "../locked-json.js";

const CLAIMS_FILE = ".ritsu/task-claims.json";

interface TaskClaim {
  span_id: string;
  agent_id: string;
  claimed_at: string;
}

interface PendingTask {
  span_id: string;
  role: string;
  description: string;
  priority: string;
  source: string;
  claimed_by: string | null;
}

function getStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getClaims(root: string): TaskClaim[] {
  const path = resolve(root, CLAIMS_FILE);
  return readJsonFile<TaskClaim[]>(path, []);
}

export async function ritsu_list_pending_tasks(_params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  const entries = readAllEntries(root);
  if (!existsSync(ritsuDir)) return textResult(JSON.stringify({ tasks: [] }));
  const allFiles = readdirSync(ritsuDir);
  const sheets = allFiles.filter((file) => file.includes("coordination-sheet"));
  const claims = getClaims(root);
  const pendingTasks: PendingTask[] = [];

  for (const sheet of sheets) {
    const content = readFileSync(resolve(ritsuDir, sheet), "utf-8");
    const spanMatches = [...content.matchAll(/\| (span-[0-9a-f-]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g)];

    for (const match of spanMatches) {
      const spanId = match[1];
      const role = match[2].trim();
      const desc = match[3].trim();
      const priority = match[4].trim();

      // Check if done
      const isDone = entries.some((entry) => {
        const entrySpanId = getStringField(entry, "span_id");
        const status = getStringField(entry, "status");
        return entrySpanId === spanId && (status === "done" || status === "failed");
      });
      if (isDone) continue;

      // Check if claimed
      const claim = claims.find((taskClaim) => taskClaim.span_id === spanId);

      pendingTasks.push({
        span_id: spanId,
        role,
        description: desc,
        priority,
        source: sheet,
        claimed_by: claim ? claim.agent_id : null,
      });
    }
  }

  return textResult(JSON.stringify({ tasks: pendingTasks }));
}

export async function ritsu_claim_task(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const spanId = String(params.span_id);
  const agentId = String(params.agent_id);

  const result = await updateLockedJsonFile<TaskClaim[], Record<string, unknown>>(
    resolve(root, CLAIMS_FILE),
    [],
    (claims) => {
      const existing = claims.find((claim) => claim.span_id === spanId);
      if (existing && existing.agent_id !== agentId) {
        return {
          data: claims,
          result: {
            ok: false,
            message: `Task ${spanId} already claimed by agent ${existing.agent_id}`,
          },
        };
      }

      if (!existing) {
        claims.push({
          span_id: spanId,
          agent_id: agentId,
          claimed_at: new Date().toISOString(),
        });
      }

      return {
        data: claims,
        result: {
          ok: true,
          message: `Task ${spanId} claimed by ${agentId}`,
        },
      };
    },
  );

  return textResult(JSON.stringify(result));
}

export async function ritsu_task_coordination(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = String(params.action ?? "list");
  if (action === "claim") {
    return ritsu_claim_task(params);
  } else if (action === "list") {
    return ritsu_list_pending_tasks(params);
  }
  return jsonErrorResult({
    error: "INVALID_ACTION",
    message: "Action must be claim or list.",
  });
}
