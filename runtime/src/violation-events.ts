import { appendEvent } from "./ctx-writer.js";
import { validateEvent } from "./event-validator.js";
import { ts } from "./handlers/_utils.js";
import { captureViolation } from "./violation-tracker.js";

export async function emitViolationEvent(
  root: string,
  ruleId: string,
  severity: string,
  message: string,
  evidence?: string,
): Promise<void> {
  const event = {
    ts: ts(),
    status: "violation_detected",
    violation: {
      rule_id: ruleId,
      severity,
      evidence: evidence || message,
      blocked: true,
    },
  };

  const validation = validateEvent(event);
  if (!validation.valid) {
    console.warn("[ritsu] violation event validation failed, dropping:", validation.errors?.join(", "));
    return;
  }

  await appendEvent(root, event);

  // Also capture to violation tracker for lifecycle management
  try {
    captureViolation(root, {
      rule_id: ruleId,
      severity,
      message,
      evidence,
    });
  } catch {
    // best-effort: tracker never blocks event emit
  }
}
