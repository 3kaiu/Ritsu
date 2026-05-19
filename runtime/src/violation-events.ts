import { appendEvent } from "./ctx-writer.js";
import { validateEvent } from "./event-validator.js";
import { ts } from "./handlers/_utils.js";

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
    return;
  }

  await appendEvent(root, event);
}
