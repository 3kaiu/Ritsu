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
  const violations: any[] = [];

  for (const f of files) {
    const lines = readFileSync(join(ritsuDir, f), "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const eventDate = new Date(obj.ts);
        if (eventDate < cutoffDate) continue;

        if (obj.status === "artifact_written" && obj.artifact) {
          artifactEvents.push({ ts: obj.ts, artifact: obj.artifact });
        } else if (obj.status === "violation_detected") {
          violations.push(obj);
        }
      } catch { /* ignore malformed lines */ }
    }
  }

  // Keep only the latest write event for each artifact
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
      const diff = execSync(`git log -p --since="${ts}" -- "${file}"`, {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();

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
      // Ignore git errors
    }
  }

  if (corrections.length === 0 && violations.length === 0) return null;

  // Generate Mining Sheet
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = join(ritsuDir, `mining-sheet-${dateStr}.md`);

  const lines = [
    `# Ritsu Preference Mining Sheet`,
    `> Generated: ${dateStr} (Scanning past ${days} days)`,
    ``,
    `## Section 1: Human Corrections`,
    `The following diffs represent files that were initially written by the AI, but subsequently modified by humans.`,
    ``,
  ];

  for (const c of corrections) {
    lines.push(`### File: \`${c.file}\``);
    lines.push("```diff");
    lines.push(c.diff);
    lines.push("```");
    lines.push("");
  }

  if (violations.length > 0) {
    lines.push(`## Section 2: Policy Violations`);
    lines.push(`The following violations were detected by Ritsu's policy engine during the last ${days} days.`);
    lines.push(``);
    for (const v of violations) {
      lines.push(`- **Rule**: ${v.rule_id} (${v.skill})`);
      lines.push(`  - **Message**: ${v.message}`);
      lines.push(`  - **Evidence**: \`${v.evidence}\``);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`## Proposals for AI Assistant:`);
  lines.push(`Please analyze the data above and propose new preference rules in the following YAML format:`);
  lines.push(``);
  lines.push("```yaml");
  lines.push("- id: pref-unique-id");
  lines.push("  match_regex: \"...\"");
  lines.push("  scope: coding_style");
  lines.push("  auto_inject_to: [think, dev]");
  lines.push("```");
  lines.push(``);

  writeFileSync(outPath, lines.join("\n"));
  return outPath;
}

export function promotePreference(prefId: string): boolean {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);
  const prefPath = resolve(root, ".ritsu/preferences.yaml");

  const files = readdirSync(ritsuDir).filter((f) => f.startsWith("mining-sheet-") && f.endsWith(".md")).sort();
  if (files.length === 0) return false;

  // Search from the most recent sheet
  for (let i = files.length - 1; i >= 0; i--) {
    const content = readFileSync(join(ritsuDir, files[i]), "utf-8");
    // Simple regex to extract YAML block with specific prefId
    // This is a bit naive but works for a prototype
    const regex = new RegExp(`- id: ${prefId}[\\s\\S]+?(?=\\n-|\\n\\s*\\n|\\n\`\`\`)`, "g");
    const match = content.match(regex);
    
    if (match) {
      const yamlSnippet = match[0].trim();
      let currentPrefs = "";
      if (existsSync(prefPath)) {
        currentPrefs = readFileSync(prefPath, "utf-8");
      }
      
      // Check if already exists
      if (currentPrefs.includes(`id: ${prefId}`)) {
        return true; // Already promoted
      }

      const separator = currentPrefs.trim() ? "\n\n" : "preferences:\n";
      writeFileSync(prefPath, currentPrefs.trim() + separator + yamlSnippet + "\n");
      return true;
    }
  }

  return false;
}

