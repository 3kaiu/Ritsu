import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getProjectRoot } from "./handlers/_utils.js";

const RITSU_DIR = ".ritsu";

type ArtifactEvent = {
  ts: string;
  artifact: string;
};

export function minePreferences(days: number): string | null {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);

  if (!existsSync(ritsuDir)) return null;

  const files = readdirSync(ritsuDir).filter((f) => f.startsWith("ctx-") && f.endsWith(".jsonl"));
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const artifactEvents: ArtifactEvent[] = [];

  for (const f of files) {
    const lines = readFileSync(join(ritsuDir, f), "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.status === "artifact_written" && obj.artifact) {
          const eventDate = new Date(obj.ts);
          if (eventDate >= cutoffDate) {
            artifactEvents.push({ ts: obj.ts, artifact: obj.artifact });
          }
        }
      } catch {}
    }
  }

  // Keep only the earliest write event within the window for each artifact to see all subsequent changes
  // Or rather, the latest write event? If AI writes it multiple times, we want the diff after the LAST AI write.
  const latestWrites = new Map<string, string>();
  for (const e of artifactEvents) {
    const existing = latestWrites.get(e.artifact);
    if (!existing || new Date(e.ts) > new Date(existing)) {
      latestWrites.set(e.artifact, e.ts);
    }
  }

  const corrections: Array<{ file: string; diff: string }> = [];

  for (const [file, ts] of latestWrites.entries()) {
    try {
      // Get git diff from the time of AI writing until now (HEAD or Working Tree)
      // We can use git diff with a time-based rev parse, but simpler: git log -p since ts
      // Or just git diff HEAD@{ts} -- file? git reflog might not have it.
      // Easiest reliable way: git log -p --since="<ts>" -- <file>
      const diff = execSync(`git log -p --since="${ts}" -- "${file}"`, {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();

      // If the file is modified in the working tree, also grab that diff
      const workingDiff = execSync(`git diff -- "${file}"`, {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();

      let combinedDiff = diff;
      if (workingDiff) combinedDiff += "\n\n[Uncommitted Working Tree Changes]\n" + workingDiff;

      if (combinedDiff.trim().length > 10) {
        corrections.push({ file, diff: combinedDiff });
      }
    } catch {
      // Ignore git errors (e.g., file not tracked)
    }
  }

  if (corrections.length === 0) return null;

  // Generate Mining Sheet
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = join(ritsuDir, `mining-sheet-${dateStr}.md`);

  const lines = [
    `# Ritsu Preference Mining Sheet`,
    `> Generated: ${dateStr} (Scanning past ${days} days)`,
    ``,
    `The following diffs represent files that were initially written by the AI, but subsequently modified (corrected) by humans or subsequent commits.`,
    ``,
    `## Task for the AI Assistant:`,
    `Please carefully analyze the diffs below. Your goal is to extract **tacit knowledge** and **implicit team preferences** from these corrections.`,
    `If you identify a clear pattern (e.g., "The human replaced \`console.log\` with \`logger.info\`" or "The human restructured the React component to use a specific custom hook"), please define a new anti-pattern or preference rule.`,
    ``,
    `Output your findings in the format required by \`rules/anti-patterns.yaml\` or \`preferences.yaml\`.`,
    ``,
    `---`,
    ``,
  ];

  for (const c of corrections) {
    lines.push(`### File: \`${c.file}\``);
    lines.push("```diff");
    lines.push(c.diff);
    lines.push("```");
    lines.push("");
  }

  writeFileSync(outPath, lines.join("\n"));
  return outPath;
}
