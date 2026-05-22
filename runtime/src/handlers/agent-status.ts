/**
 * Multi-Agent Status — 跨 Agent 协调查询
 *
 * 查询当前活动的 span，按 agent 分组，返回谁在做什么、进度如何。
 * 供 AI Agent 在开始工作前确认没有其他 Agent 在做同一件事。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { readAllEntries } from "../ctx-reader.js";

interface AgentStatus {
  agent_id: string;
  skill: string;
  step: string;
  status: string;
  last_artifact: string | null;
  span_id: string;
  trace_id: string;
}

export async function ritsu_agent_status(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const currentSpanOnly = params.current_span_only !== false;

  try {
    const entries = readAllEntries(root);

    // Group by span_id, collect latest status per span
    const spanMap = new Map<string, Map<string, { entry: Record<string, unknown>; ts: string }>>();

    for (const entry of entries) {
      const agent = entry.agent && typeof entry.agent === "object"
        ? (entry.agent as Record<string, unknown>)
        : null;
      const agentId = typeof agent?.id === "string" ? agent.id
        : typeof entry.agent === "string" ? entry.agent
        : "unknown";
      const spanId = String(entry.span_id ?? "unknown");
      const ts = String(entry.ts ?? "");

      if (!spanMap.has(spanId)) {
        spanMap.set(spanId, new Map());
      }
      const agentMap = spanMap.get(spanId)!;

      if (!agentMap.has(agentId) || ts > agentMap.get(agentId)!.ts) {
        agentMap.set(agentId, { entry, ts });
      }
    }

    const activeAgents: AgentStatus[] = [];

    for (const [spanId, agentMap] of spanMap) {
      for (const [agentId, { entry }] of agentMap) {
        const status = String(entry.status ?? "unknown");
        const skill = String(entry.skill ?? "");
        const step = String(entry.step ?? "");
        const traceId = String(entry.trace_id ?? "");

        // Filter to active spans only
        if (currentSpanOnly && status === "done") continue;

        let lastArtifact: string | null = null;
        if (entry.artifact && typeof entry.artifact === "string") {
          lastArtifact = entry.artifact;
        }

        activeAgents.push({
          agent_id: agentId,
          skill,
          step,
          status,
          last_artifact: lastArtifact,
          span_id: spanId,
          trace_id: traceId,
        });
      }
    }

    return textResult(JSON.stringify({
      active_count: activeAgents.length,
      agents: activeAgents,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`ritsu_agent_status failed: ${message}`);
  }
}
