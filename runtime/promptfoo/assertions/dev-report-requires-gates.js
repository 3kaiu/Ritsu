export default async function assertDevReportRequiresGates(_output, context) {
  const content = context.vars.content;
  const hasGates =
    content.includes("质量门禁对账") || content.includes("Quality Gates");
  return {
    pass: !hasGates,
    score: !hasGates ? 1 : 0,
    reason: hasGates
      ? undefined
      : "fixture correctly lacks gates — structural lint would flag in write-artifact",
  };
}
