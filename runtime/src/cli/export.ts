import { resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { detectProjectRoot } from "../project-root.js";
import { findLatestCtxFile, parseJsonl, color, summarizeTasks } from "./shared.js";

export async function runExport(outPath: string | null) {
  const root = detectProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found to export", "red"));
    process.exit(1);
  }

  const events = parseJsonl(ctxFile);
  const tasks = summarizeTasks(events);

  const lines = [
    `# Ritsu Task Export — ${new Date().toISOString().slice(0, 10)}`,
    `Generated from: \`${ctxFile}\``,
    "",
    "## Task History",
    "",
    "| CID | Skill | Domain | Status | Duration | Artifacts | Tokens (In/Out) |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const [cid, t] of Object.entries(tasks)) {
    const statusIcon = t.status === "completed" ? "✅" : (t.status === "failed" ? "❌" : "⏳");
    const arts = t.artifacts.length > 0 ? t.artifacts.map(a => `\`${a}\``).join(", ") : "-";
    const tokens = `${t.totalTokensIn} / ${t.totalTokensOut}`;
    lines.push(`| \`${cid}\` | ${t.skill} | ${t.domain} | ${statusIcon} ${t.status} | ${t.startTs} | ${arts} | ${tokens} |`);
  }

  const markdown = lines.join("\n");
  if (outPath) {
    writeFileSync(resolve(root, outPath), markdown);
    console.log(color(`Exported to: ${outPath}`, "green"));
  } else {
    console.log(markdown);
  }
}
