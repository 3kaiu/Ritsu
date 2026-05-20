import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot } from "./handlers/_utils.js";

const RITSU_DIR = ".ritsu";

type ArtifactEvent = {
  ts: string;
  ts_ms: number;
  artifact: string;
};

type ViolationEvent = {
  rule_id?: string;
  skill?: string;
  message?: string;
  evidence?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEventTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const ritsuTs = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
  );
  if (ritsuTs) {
    const [, yyyy, mm, dd, hh, mi, ss] = ritsuTs;
    const parsed = Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
    );
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeViolationEvent(event: Record<string, unknown>): ViolationEvent {
  const nestedViolation = isRecord(event.violation) ? event.violation : undefined;

  return {
    rule_id:
      typeof nestedViolation?.rule_id === "string"
        ? nestedViolation.rule_id
        : typeof event.rule_id === "string"
          ? event.rule_id
          : undefined,
    skill: typeof event.skill === "string" ? event.skill : undefined,
    message:
      typeof event.message === "string"
        ? event.message
        : typeof event.error === "string"
          ? event.error
          : undefined,
    evidence:
      typeof nestedViolation?.evidence === "string"
        ? nestedViolation.evidence
        : typeof event.evidence === "string"
          ? event.evidence
          : undefined,
  };
}

type PreferenceRule = Record<string, unknown> & {
  id: string;
};

type PreferencesDoc = {
  rules?: PreferenceRule[];
  preferences?: PreferenceRule[];
};

function isPreferenceRule(value: unknown): value is PreferenceRule {
  return isRecord(value) && typeof value.id === "string" && value.id.trim().length > 0;
}

function normalizePreferenceRules(doc: unknown): PreferenceRule[] {
  if (Array.isArray(doc)) {
    return doc.filter(isPreferenceRule);
  }

  if (!isRecord(doc)) return [];

  const typedDoc = doc as PreferencesDoc;
  const rules = Array.isArray(typedDoc.rules)
    ? typedDoc.rules
    : Array.isArray(typedDoc.preferences)
      ? typedDoc.preferences
      : [];

  return rules.filter(isPreferenceRule);
}

function hasCanonicalRulesRoot(doc: unknown): boolean {
  return isRecord(doc) && Array.isArray((doc as PreferencesDoc).rules);
}

function extractPreferenceRuleFromSheet(
  content: string,
  prefId: string,
): PreferenceRule | null {
  const yamlBlocks = content.matchAll(/```ya?ml\s*([\s\S]*?)```/g);

  for (const match of yamlBlocks) {
    const snippet = match[1]?.trim();
    if (!snippet) continue;

    try {
      const parsed = yaml.load(snippet);
      const rule = normalizePreferenceRules(parsed).find((entry) => entry.id === prefId);
      if (rule) return { ...rule };
    } catch {
      // Ignore malformed YAML blocks and keep scanning older sheets.
    }
  }

  return null;
}

export function minePreferences(days: number): string | null {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);

  if (!existsSync(ritsuDir)) return null;

  const files = readdirSync(ritsuDir).filter(
    (f) => f.startsWith("ctx-") && f.endsWith(".jsonl"),
  );
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;

  const artifactEvents: ArtifactEvent[] = [];
  const violations: ViolationEvent[] = [];

  for (const f of files) {
    const lines = readFileSync(join(ritsuDir, f), "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as unknown;
        if (!isRecord(obj)) continue;
        if (typeof obj.ts !== "string") continue;
        const eventTs = parseEventTimestamp(obj.ts);
        if (eventTs === null || eventTs < cutoffMs) continue;

        if (
          obj.status === "artifact_written" &&
          typeof obj.artifact === "string"
        ) {
          artifactEvents.push({
            ts: obj.ts,
            ts_ms: eventTs,
            artifact: obj.artifact,
          });
        } else if (obj.status === "violation_detected") {
          violations.push(normalizeViolationEvent(obj));
        }
      } catch { /* ignore malformed lines */ }
    }
  }

  // Keep only the latest write event for each artifact
  const latestWrites = new Map<string, ArtifactEvent>();
  for (const e of artifactEvents) {
    const existing = latestWrites.get(e.artifact);
    if (!existing || e.ts_ms > existing.ts_ms) {
      latestWrites.set(e.artifact, e);
    }
  }

  const corrections: Array<{ file: string; diff: string }> = [];

  if (latestWrites.size > 0) {
    let earliestSinceMs = Infinity;
    for (const event of latestWrites.values()) {
      if (event.ts_ms < earliestSinceMs) {
        earliestSinceMs = event.ts_ms;
      }
    }

    let globalLogOutput = "";
    if (earliestSinceMs !== Infinity) {
      try {
        const since = new Date(earliestSinceMs).toISOString();
        globalLogOutput = execSync(`git log -p --date=raw --since="${since}"`, {
          cwd: root,
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
      } catch {
        // Ignore git errors
      }
    }

    let globalDiffOutput = "";
    try {
      globalDiffOutput = execSync(`git diff`, {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    } catch {
      // Ignore git errors
    }

    // Parse git log output
    type CommitBlock = {
      header: string;
      timestamp: number;
      fileDiffs: Map<string, string>;
    };

    const commits: CommitBlock[] = [];
    let currentCommit: CommitBlock | null = null;
    let currentFile: string | null = null;
    let currentFileDiffLines: string[] = [];
    let currentHeaderLines: string[] = [];
    let isParsingDiff = false;

    const logLines = globalLogOutput.split(/\r?\n/);
    for (const line of logLines) {
      if (line.startsWith("commit ")) {
        if (currentCommit && currentFile && currentFileDiffLines.length > 0) {
          currentCommit.fileDiffs.set(currentFile, currentFileDiffLines.join("\n"));
        }
        if (currentCommit) {
          commits.push(currentCommit);
        }
        currentCommit = {
          header: "",
          timestamp: 0,
          fileDiffs: new Map(),
        };
        currentFile = null;
        currentFileDiffLines = [];
        currentHeaderLines = [line];
        isParsingDiff = false;
        continue;
      }

      if (currentCommit && !isParsingDiff) {
        if (line.startsWith("diff --git ")) {
          isParsingDiff = true;
          currentCommit.header = currentHeaderLines.join("\n").trimEnd() + "\n\n";
          const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
          if (match) {
            currentFile = match[2];
          } else {
            currentFile = null;
          }
          currentFileDiffLines = [line];
        } else {
          currentHeaderLines.push(line);
          const dateMatch = line.match(/^Date:\s+(\d+)/);
          if (dateMatch) {
            currentCommit.timestamp = parseInt(dateMatch[1], 10) * 1000;
          }
        }
        continue;
      }

      if (currentCommit && isParsingDiff) {
        if (line.startsWith("diff --git ")) {
          if (currentFile && currentFileDiffLines.length > 0) {
            currentCommit.fileDiffs.set(currentFile, currentFileDiffLines.join("\n"));
          }
          const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
          if (match) {
            currentFile = match[2];
          } else {
            currentFile = null;
          }
          currentFileDiffLines = [line];
        } else {
          currentFileDiffLines.push(line);
        }
      }
    }

    if (currentCommit) {
      if (currentFile && currentFileDiffLines.length > 0) {
        currentCommit.fileDiffs.set(currentFile, currentFileDiffLines.join("\n"));
      }
      commits.push(currentCommit);
    }

    // Parse git diff output
    const uncommittedDiffs = new Map<string, string[]>();
    const diffLines = globalDiffOutput.split(/\r?\n/);
    let currentDiffFile: string | null = null;
    let currentDiffFileLines: string[] = [];

    for (const line of diffLines) {
      if (line.startsWith("diff --git ")) {
        if (currentDiffFile && currentDiffFileLines.length > 0) {
          uncommittedDiffs.set(currentDiffFile, currentDiffFileLines);
        }
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
          currentDiffFile = match[2];
        } else {
          currentDiffFile = null;
        }
        currentDiffFileLines = [line];
      } else {
        if (currentDiffFile) {
          currentDiffFileLines.push(line);
        }
      }
    }
    if (currentDiffFile && currentDiffFileLines.length > 0) {
      uncommittedDiffs.set(currentDiffFile, currentDiffFileLines);
    }

    // Reconstruct per-file diff strings
    for (const [file, event] of latestWrites.entries()) {
      const fileCommitDiffParts: string[] = [];
      for (const commit of commits) {
        if (commit.timestamp >= event.ts_ms) {
          const fileDiff = commit.fileDiffs.get(file);
          if (fileDiff) {
            fileCommitDiffParts.push(commit.header + fileDiff);
          }
        }
      }

      let combinedDiff = fileCommitDiffParts.join("\n\n").trim();

      const workingDiffLines = uncommittedDiffs.get(file);
      if (workingDiffLines && workingDiffLines.length > 0) {
        const workingDiffStr = workingDiffLines.join("\n").trim();
        if (workingDiffStr) {
          if (combinedDiff) {
            combinedDiff += "\n\n[Uncommitted Working Tree Changes]\n" + workingDiffStr;
          } else {
            combinedDiff = "[Uncommitted Working Tree Changes]\n" + workingDiffStr;
          }
        }
      }

      if (combinedDiff.trim().length > 10) {
        corrections.push({ file, diff: combinedDiff });
      }
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
      lines.push(`- **Rule**: ${v.rule_id ?? "unknown"} (${v.skill ?? "unknown"})`);
      lines.push(`  - **Message**: ${v.message ?? "n/a"}`);
      lines.push(`  - **Evidence**: \`${v.evidence ?? ""}\``);
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

  if (!existsSync(ritsuDir)) return false;

  const files = readdirSync(ritsuDir)
    .filter((f) => f.startsWith("mining-sheet-") && f.endsWith(".md"))
    .sort();
  if (files.length === 0) return false;

  // Search from the most recent sheet
  for (let i = files.length - 1; i >= 0; i--) {
    const content = readFileSync(join(ritsuDir, files[i]), "utf-8");
    const promotedRule = extractPreferenceRuleFromSheet(content, prefId);

    if (promotedRule) {
      let currentRules: PreferenceRule[] = [];
      let shouldRewriteCanonicalDoc = false;
      if (existsSync(prefPath)) {
        try {
          const parsed = yaml.load(readFileSync(prefPath, "utf-8"));
          currentRules = normalizePreferenceRules(parsed);
          shouldRewriteCanonicalDoc =
            currentRules.length > 0 && !hasCanonicalRulesRoot(parsed);
        } catch {
          currentRules = [];
        }
      }

      if (currentRules.some((rule) => rule.id === prefId)) {
        if (shouldRewriteCanonicalDoc) {
          writeFileSync(prefPath, yaml.dump({ rules: currentRules }), "utf-8");
        }
        return true;
      }

      currentRules.push(promotedRule);
      writeFileSync(prefPath, yaml.dump({ rules: currentRules }), "utf-8");
      return true;
    }
  }

  return false;
}
