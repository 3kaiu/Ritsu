import { evaluatePolicies } from "../../dist/policy/index.js";

export default async function assertPolicyBlocksTodo(_output, context) {
  const content = context.vars.content;
  const result = evaluatePolicies({
    action: "write_artifact",
    content,
    context: { skill: "dev" },
  });
  const hasAp6 = result.violations.some((v) => v.rule_id === "AP-6");
  return {
    pass: hasAp6 && !result.passed,
    score: hasAp6 ? 1 : 0,
    reason: hasAp6 ? undefined : "expected AP-6 violation for TODO",
  };
}
