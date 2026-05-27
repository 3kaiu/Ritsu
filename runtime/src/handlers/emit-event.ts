import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import {
  readQualityGateSnapshot,
  validateQualityGateSnapshotContext,
  validateQualityGateSnapshotWorktree,
} from "../quality-gates.js";
import {
  getArtifactLayer,
  getCanonicalArtifactType,
  getPreferredArtifactType,
} from "../shared.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";
import { emitViolationEvent } from "../violation-events.js";
import { autoCaptureOnEvent } from "../session-memory.js";
import { autoCheckpoint } from "../context-lifecycle.js";

export async function ritsu_emit_event(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const eventType = String(params.event_type ?? "");
  const correlationId = params.correlation_id ? String(params.correlation_id) : "";
  const traceId = params.trace_id ? String(params.trace_id) : undefined;
  const spanId = params.span_id ? String(params.span_id) : undefined;
  const step = params.step ? String(params.step) : undefined;
  const rawArtifactMeta =
    params.artifact_meta &&
    typeof params.artifact_meta === "object" &&
    !Array.isArray(params.artifact_meta)
      ? (params.artifact_meta as Record<string, unknown>)
      : undefined;
  const rawViolation =
    params.violation &&
    typeof params.violation === "object" &&
    !Array.isArray(params.violation)
      ? (params.violation as Record<string, unknown>)
      : undefined;

  if (!eventType) return errorResult("event_type is required");

  const root = getProjectRoot();

  // 构造事件对象 — correlation_id 若未提供，将在 appendEvent 的锁内原子生成
  const event: Record<string, unknown> = {
    ts: ts(),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(spanId ? { span_id: spanId } : {}),
    status: eventType,
  };
  if (params.skill) event.skill = String(params.skill);
  if (params.domain) event.domain = String(params.domain);

  if (params.agent) event.agent = params.agent;

  if (step) event.step = step;
  if (params.artifact !== undefined) event.artifact = params.artifact;
  if (params.error) event.error = String(params.error);
  if (params.cost && typeof params.cost === "object") {
    event.cost = params.cost;
  }
  if (rawViolation) {
    event.violation = rawViolation;
  }
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

  if (eventType === "done" && event.skill === "dev") {
    const qualityGateState = readQualityGateSnapshot(root);
    if (!qualityGateState.ok) {
      const message = `quality gates must be run before emit_event(done) for dev: ${qualityGateState.message}`;
      await emitViolationEvent(root, "AP-5", "fatal", message, qualityGateState.path);
      return errorResult(message);
    }
    const contextValidation = validateQualityGateSnapshotContext(
      qualityGateState.snapshot,
      {
        correlation_id: correlationId || undefined,
        trace_id: traceId,
        span_id: spanId,
        skill: typeof event.skill === "string" ? event.skill : undefined,
        domain: typeof event.domain === "string" ? event.domain : undefined,
      },
    );
    if (!contextValidation.ok) {
      await emitViolationEvent(
        root,
        "AP-5",
        "fatal",
        contextValidation.message,
        contextValidation.actual.join("; "),
      );
      return errorResult(contextValidation.message);
    }
    const worktreeValidation = await validateQualityGateSnapshotWorktree(
      root,
      qualityGateState.snapshot,
    );
    if (!worktreeValidation.ok) {
      await emitViolationEvent(
        root,
        "AP-5",
        "fatal",
        worktreeValidation.message,
        worktreeValidation.actual.join("; "),
      );
      return errorResult(worktreeValidation.message);
    }
    if (qualityGateState.snapshot.status !== "passed") {
      const message = `quality gates must pass before emit_event(done) for dev; current status: ${qualityGateState.snapshot.status}`;
      await emitViolationEvent(root, "AP-5", "fatal", message);
      return errorResult(message);
    }
  }

  // Schema 校验必须在写入前完成；correlation_id 缺失不影响 schema 判定。
  const validation = validateEvent(event);
  if (!validation.valid) {
    return errorResult(
      `event validation failed: ${validation.errors?.join(", ")}`,
    );
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

  // 跨会话记忆：自动捕获关键事件（违规、偏好学习等）
  autoCaptureOnEvent(event);

  // 在 step 完成和 artifact 写入时自动保存检查点
  // 用于会话恢复（会话断裂后新会话可通过 preflight 恢复上下文）
  if (eventType === "done" || eventType === "artifact_written" || eventType === "failed") {
    try {
      const skill = typeof event.skill === "string" ? event.skill : "";
      if (skill) {
        autoCheckpoint(root, skill, typeof params.task_goal === "string" ? params.task_goal : "");
      }
    } catch {
      // checkpoint is best-effort, never block event write
    }
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
