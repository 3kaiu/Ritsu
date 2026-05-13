import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import {
  getArtifactLayer,
  getCanonicalArtifactType,
  getPreferredArtifactType,
} from "../shared.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";

export async function ritsu_emit_event(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const eventType = String(params.event_type ?? "");
  const correlationId = params.correlation_id
    ? String(params.correlation_id)
    : "";
  const step = params.step ? String(params.step) : undefined;
  const rawArtifactMeta =
    params.artifact_meta &&
    typeof params.artifact_meta === "object" &&
    !Array.isArray(params.artifact_meta)
      ? (params.artifact_meta as Record<string, unknown>)
      : undefined;

  if (!eventType) return errorResult("event_type is required");

  const root = getProjectRoot();

  // 构造事件对象 — correlation_id 若未提供，将在 appendEvent 的锁内原子生成
  const event: Record<string, unknown> = {
    ts: ts(),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    skill: String(params.skill ?? "unknown"),
    domain: String(params.domain ?? "unknown"),
    status: eventType,
  };

  if (step) event.step = step;
  if (params.artifact !== undefined) event.artifact = params.artifact;
  if (params.error) event.error = String(params.error);
  if (rawArtifactMeta) {
    const rawArtifactType =
      typeof rawArtifactMeta.type === "string" ? rawArtifactMeta.type : "";
    const artifactType = rawArtifactType
      ? getPreferredArtifactType(rawArtifactType)
      : "";
    const canonicalType = rawArtifactType
      ? getCanonicalArtifactType(rawArtifactType)
      : "";
    event.artifact_meta = {
      ...rawArtifactMeta,
      ...(artifactType ? { type: artifactType } : {}),
      ...(canonicalType && !rawArtifactMeta.canonical_type
        ? { canonical_type: canonicalType }
        : {}),
      ...(artifactType && !rawArtifactMeta.layer
        ? { layer: getArtifactLayer(artifactType) }
        : {}),
    };
  }

  // Schema 校验（不含 correlation_id 时跳过，因为锁内才生成）
  if (correlationId) {
    const validation = validateEvent(event);
    if (!validation.valid) {
      return errorResult(
        `event validation failed: ${validation.errors?.join(", ")}`,
      );
    }
  }

  // 原子写入 — correlation_id 生成和追加在同一个异步锁内完成
  const result = await appendEvent(root, event);

  // 写入后校验完整事件（含锁内生成的 correlation_id）
  const fullEvent = { ...event, correlation_id: result.correlation_id };
  const postValidation = validateEvent(fullEvent);
  if (!postValidation.valid) {
    return errorResult(
      `event written but validation failed: ${postValidation.errors?.join(", ")}`,
    );
  }

  return textResult(
    JSON.stringify({
      written: true,
      line_count: result.lineCount,
      ts: event.ts,
      correlation_id: result.correlation_id,
    }),
  );
}
