import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot } from "./handlers/_utils.js";
import { reconcilePreferences } from "./policy/detectors/ast-grep-reconciler.js";
import { isRecord } from "./shared.js";
import { synthesizeWithLLM } from "./llm-synthesizer.js";

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

export type PreferenceRule = Record<string, unknown> & {
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

// ─── Shared: scan human corrections from ctx files ────────────

type ScanResult = {
  corrections: Array<{ file: string; diff: string }>;
  violations: ViolationEvent[];
};

function scanHumanCorrections(root: string, days: number): ScanResult {
  const ritsuDir = resolve(root, RITSU_DIR);

  if (!existsSync(ritsuDir)) return { corrections: [], violations: [] };

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
      if (event.ts_ms < earliestSinceMs) earliestSinceMs = event.ts_ms;
    }

    let globalLogOutput = "";
    if (earliestSinceMs !== Infinity) {
      try {
        const since = new Date(earliestSinceMs).toISOString();
        const fileNames = Array.from(latestWrites.keys());
        globalLogOutput = execFileSync("git", [
          "log", "-p", "--date=raw", `--since=${since}`, "--", ...fileNames,
        ], {
          cwd: root,
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 10 * 1024 * 1024,
        }).toString();
      } catch { /* ignore git errors */ }
    }

    let globalDiffOutput = "";
    if (latestWrites.size > 0) {
      try {
        const fileNames = Array.from(latestWrites.keys());
        globalDiffOutput = execFileSync("git", [
          "diff", "--", ...fileNames,
        ], {
          cwd: root,
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 10 * 1024 * 1024,
        }).toString();
      } catch { /* ignore git errors */ }
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

  return { corrections, violations };
}

// ─── minePreferences ──────────────────────────────────────────

export function minePreferences(days: number): string | null {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);

  const { corrections, violations } = scanHumanCorrections(root, days);

  if (corrections.length === 0 && violations.length === 0) return null;

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
        reconcilePreferences();
        return true;
      }

      currentRules.push(promotedRule);
      writeFileSync(prefPath, yaml.dump({ rules: currentRules }), "utf-8");
      reconcilePreferences();
      return true;
    }
  }

  return false;
}

// ─── Auto-apply mined rules ───────────────────────────────────

type DiffHunk = {
  deletedLines: string[];
  addedLines: string[];
};

function parseDiffHunksFromDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffText.split(/\r?\n/);

  let currentDeleted: string[] = [];
  let currentAdded: string[] = [];

  const flushHunk = () => {
    if (currentDeleted.length > 0 || currentAdded.length > 0) {
      hunks.push({
        deletedLines: [...currentDeleted],
        addedLines: [...currentAdded]
      });
      currentDeleted = [];
      currentAdded = [];
    }
  };

  for (const line of lines) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("@@ ") ||
      line.startsWith("commit ") ||
      line.startsWith("[Uncommitted ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      flushHunk();
      continue;
    }

    if (line.startsWith("-")) {
      if (currentAdded.length > 0) {
        flushHunk();
      }
      currentDeleted.push(line.slice(1));
    } else if (line.startsWith("+")) {
      currentAdded.push(line.slice(1));
    } else {
      flushHunk();
    }
  }
  flushHunk();
  return hunks;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function synthesizeRulesFromCorrections(
  corrections: Array<{ file: string; diff: string }>
): PreferenceRule[] {
  const rules: PreferenceRule[] = [];
  const genericDeletedFreqs = new Map<string, number>();

  for (const corr of corrections) {
    const hunks = parseDiffHunksFromDiff(corr.diff);
    for (const hunk of hunks) {
      // Heuristic 1: Logger Substitution
      const hasConsole = hunk.deletedLines.some(line =>
        /console\.(log|warn|error|info)\b/.test(line)
      );
      const hasLogger = hunk.addedLines.some(line =>
        /(?:logger|log)\.(info|warn|error|debug|log)\b/.test(line) && !/console\./.test(line)
      );
      if (hasConsole && hasLogger) {
        if (!rules.some(r => r.id === "pref-auto-logger")) {
          rules.push({
            id: "pref-auto-logger",
            match_regex: "console\\.(log|warn|error|info)",
            scope: "coding_style",
            auto_inject_to: ["think", "dev"],
            message: "Use project logger instead of console.log/warn/error/info."
          });
        }
      }

      // Heuristic 2: Variable Declaration Tightening
      for (let i = 0; i < Math.min(hunk.deletedLines.length, hunk.addedLines.length); i++) {
        const delLine = hunk.deletedLines[i];
        const addLine = hunk.addedLines[i];
        const letMatch = delLine.match(/\blet\s+([a-zA-Z_]\w*)\b/);
        const constMatch = addLine.match(/\bconst\s+([a-zA-Z_]\w*)\b/);
        if (letMatch && constMatch && letMatch[1] === constMatch[1]) {
          if (!rules.some(r => r.id === "pref-auto-const")) {
            rules.push({
              id: "pref-auto-const",
              match_regex: "\\blet\\s+([a-zA-Z_]\\w*)\\b",
              scope: "coding_style",
              auto_inject_to: ["think", "dev"],
              message: "Prefer const over let for variables that are not reassigned."
            });
          }
        }
      }

      // Heuristic 3: Strong Type Safety
      const hasAny = hunk.deletedLines.some(line => /:\s*any\b/.test(line));
      const hasStrongType = hunk.addedLines.some(line =>
        /:\s*(?:string|number|boolean|Record|object|unknown|void|[A-Z][a-zA-Z0-9_]*)\b/.test(line) && !/:\s*any\b/.test(line)
      );
      if (hasAny && hasStrongType) {
        if (!rules.some(r => r.id === "pref-auto-no-any")) {
          rules.push({
            id: "pref-auto-no-any",
            match_regex: ":\\s*any\\b",
            scope: "type_safety",
            auto_inject_to: ["think", "dev"],
            message: "Avoid using 'any' type; prefer explicit strong TypeScript typing."
          });
        }
      }

      // Heuristic 4: Imports Sanitization
      const hasLodash = hunk.deletedLines.some(line => /from\s+['"]lodash['"]/.test(line));
      const hasLodashEs = hunk.addedLines.some(line => /from\s+['"]lodash-es['"]/.test(line));
      if (hasLodash && hasLodashEs) {
        if (!rules.some(r => r.id === "pref-auto-lodash-es")) {
          rules.push({
            id: "pref-auto-lodash-es",
            match_regex: "import\\s+.*\\s+from\\s+['\"]lodash['\"]",
            scope: "performance",
            auto_inject_to: ["think", "dev"],
            message: "Prefer 'lodash-es' over 'lodash' for better tree-shaking and modern bundles."
          });
        }
      }

      // Collect generic deleted lines for frequency analysis
      for (const line of hunk.deletedLines) {
        const trimmed = line.trim();
        if (
          trimmed.length >= 6 &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*")
        ) {
          genericDeletedFreqs.set(trimmed, (genericDeletedFreqs.get(trimmed) ?? 0) + 1);
        }
      }
    }
  }

  // Heuristic 5: Generic Recurring Correction Mining
  for (const [trimmedLine, freq] of genericDeletedFreqs.entries()) {
    if (freq >= 2) {
      const escaped = escapeRegExp(trimmedLine);
      const hash = hashString(trimmedLine);
      const ruleId = `pref-auto-mined-${hash}`;

      if (!rules.some(r => r.id === ruleId)) {
        rules.push({
          id: ruleId,
          match_regex: escaped,
          scope: "coding_style",
          auto_inject_to: ["think", "dev"],
          message: `Avoid using pattern: "${trimmedLine}". Multiple human corrections substituted this pattern.`
        });
      }
    }
  }

  return rules;
}

export async function autoApplyMinedRules(days: number): Promise<{ addedCount: number; rules: PreferenceRule[] }> {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);
  const prefPath = resolve(root, ".ritsu/preferences.yaml");

  if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });

  const { corrections, violations } = scanHumanCorrections(root, days);
  const synthesizedRules = synthesizeRulesFromCorrections(corrections);

  // LLM-driven rule synthesis (supplements heuristic rules when enabled)
  const llmRules = await synthesizeWithLLM({
    corrections,
    violations,
    existingRules: [],
  });

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

  let addedCount = 0;
  const allNewRules = [...synthesizedRules, ...llmRules];
  for (const syn of allNewRules) {
    const exists = currentRules.some(
      (existing) =>
        existing.id === syn.id || existing.match_regex === syn.match_regex
    );
    if (!exists) {
      currentRules.push(syn);
      addedCount++;
    }
  }

  if (addedCount > 0 || shouldRewriteCanonicalDoc) {
    writeFileSync(prefPath, yaml.dump({ rules: currentRules }), "utf-8");
    reconcilePreferences();
  }

  return {
    addedCount,
    rules: synthesizedRules
  };
}
