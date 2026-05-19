export default async function assertDesignHasContracts(_output, context) {
  const content = context.vars.content;
  const pass =
    content.includes("契约验证 (Contracts)") &&
    /\|\s*C\d+\s*\|/.test(content);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? undefined : "design-sheet missing contracts table",
  };
}
