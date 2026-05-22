import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot } from "./handlers/_utils.js";
import { reconcilePreferences } from "./policy/detectors/ast-grep-reconciler.js";
import { isRecord } from "./shared.js";
import { synthesizeWithLLM } from "./llm-synthesizer.js";
import { jaccardSimilarity } from "./similarity.js";
import * as ts from "typescript";
import { readSync } from "node:fs";

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
          "log",
          "-p",
          "--date=raw",
          `--since=${since}`,
          "--format=<RITSU_COMMIT_START>%ncommit %H%nAuthor: %an <%ae>%nDate: %ct%n%n%B",
          "--",
          ...fileNames,
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
    const fileNames = Array.from(latestWrites.keys());

    if (globalLogOutput) {
      const commitChunks = globalLogOutput.split(/<RITSU_COMMIT_START>\r?\n/);
      for (const chunk of commitChunks) {
        if (!chunk.trim()) continue;

        // Find the first diff --git line
        const diffIndex = chunk.indexOf("diff --git ");
        let header = "";
        let diffsBlock = "";
        if (diffIndex !== -1) {
          header = chunk.substring(0, diffIndex).trimEnd() + "\n\n";
          diffsBlock = chunk.substring(diffIndex);
        } else {
          header = chunk.trimEnd() + "\n\n";
        }

        // Extract timestamp from Date: raw line
        let timestamp = 0;
        const dateMatch = header.match(/^Date:\s+(\d+)/m);
        if (dateMatch) {
          timestamp = parseInt(dateMatch[1], 10) * 1000;
        }

        const fileDiffs = new Map<string, string>();
        if (diffsBlock) {
          const fileDiffChunks = diffsBlock.split(/\r?\n(?=diff --git )/);
          for (const fileChunk of fileDiffChunks) {
            if (!fileChunk.startsWith("diff --git ")) continue;
            const firstLine = fileChunk.split(/\r?\n/)[0];
            let matchedFile: string | null = null;
            for (const file of fileNames) {
              const escapedFile = file.replace(/\\/g, "/");
              if (firstLine.includes(` b/${escapedFile}`) || firstLine.includes(` "b/${escapedFile}"`)) {
                matchedFile = file;
                break;
              }
            }
            if (matchedFile) {
              fileDiffs.set(matchedFile, fileChunk);
            }
          }
        }

        commits.push({
          header,
          timestamp,
          fileDiffs,
        });
      }
    }

    // Parse git diff output
    const uncommittedDiffs = new Map<string, string[]>();
    if (globalDiffOutput) {
      const uncommittedDiffChunks = globalDiffOutput.split(/\r?\n(?=diff --git )/);
      for (const chunk of uncommittedDiffChunks) {
        if (!chunk.startsWith("diff --git ")) continue;
        const firstLine = chunk.split(/\r?\n/)[0];
        let matchedFile: string | null = null;
        for (const file of fileNames) {
          const escapedFile = file.replace(/\\/g, "/");
          if (firstLine.includes(` b/${escapedFile}`) || firstLine.includes(` "b/${escapedFile}"`)) {
            matchedFile = file;
            break;
          }
        }
        if (matchedFile) {
          uncommittedDiffs.set(matchedFile, chunk.split(/\r?\n/));
        }
      }
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

// ─── Heuristic Rule Extraction (no LLM required) ──────────────

interface HeuristicPattern {
  name: string;
  test: (diff: string) => boolean;
  build: () => PreferenceRule;
  confidence: number; // 0-1
}

const HEURISTIC_PATTERNS: HeuristicPattern[] = [
  {
    name: "prefer-const",
    confidence: 0.85,
    test: (diff) => /^-.*\blet\b.*=.*\n^\+.*\bconst\b.*=.*/m.test(diff),
    build: () => ({
      id: "pref-prefer-const",
      match_regex: "\\blet\\s+\\w+\\s*=",
      scope: "coding_style",
      auto_inject_to: ["think", "dev"],
      message: "Prefer const over let for variables that are never reassigned",
    }),
  },
  {
    name: "prefer-arrow-function",
    confidence: 0.7,
    test: (diff) =>
      /^-.*\bfunction\s+\w+\s*\(/.test(diff) &&
      /^\+.*\bconst\s+\w+\s*=\s*(?:\(.*\)|\w+)\s*=>/.test(diff),
    build: () => ({
      id: "pref-arrow-function",
      match_regex: "function\\s+\\w+\\s*\\([^)]*\\)\\s*\\{",
      scope: "coding_style",
      auto_inject_to: ["dev"],
      message: "Use arrow function expressions instead of function declarations for callbacks",
    }),
  },
  {
    name: "prefer-template-literal",
    confidence: 0.7,
    test: (diff) =>
      /^-.*['"][^'"]*['"]\s*\+/.test(diff) &&
      /^\+.*`/.test(diff),
    build: () => ({
      id: "pref-template-literal",
      match_regex: `'["']\\s*\\+\\s*\\w+\\s*\\+\\s*['"]`,
      scope: "coding_style",
      auto_inject_to: ["dev"],
      message: "Use template literals (`...`) instead of string concatenation",
    }),
  },
  {
    name: "prefer-strict-equality",
    confidence: 0.9,
    test: (diff) => /^-.*==[^=].*\n^\+.*===/m.test(diff) || /^-.*!=[^=].*\n^\+.*!==/m.test(diff),
    build: () => ({
      id: "pref-strict-equality",
      match_regex: "(?<!!)={2}(?!=)|(?<!!)={2}(?!=)",
      scope: "type_safety",
      auto_inject_to: ["think", "dev"],
      message: "Use strict equality (=== / !==) instead of loose equality (== / !=)",
    }),
  },
  {
    name: "prefer-async-await",
    confidence: 0.65,
    test: (diff) => /^-.*\.then\s*\(/.test(diff) && /^\+.*await\b/.test(diff),
    build: () => ({
      id: "pref-async-await",
      match_regex: "\\.then\\s*\\(",
      scope: "performance",
      auto_inject_to: ["dev"],
      message: "Prefer async/await over .then() chains for better readability",
    }),
  },
];

function clusterCorrections(corrections: Array<{ file: string; diff: string }>): Map<string, number> {
  const clusters = new Map<string, number>();

  for (let i = 0; i < corrections.length; i++) {
    for (let j = i + 1; j < corrections.length; j++) {
      const score = jaccardSimilarity(corrections[i].diff, corrections[j].diff);
      if (score > 0.4) {
        // Both diffs belong to the same cluster — increment their counts
        const keyI = corrections[i].file;
        const keyJ = corrections[j].file;
        clusters.set(keyI, (clusters.get(keyI) ?? 1) + 1);
        clusters.set(keyJ, (clusters.get(keyJ) ?? 1) + 1);
      }
    }
  }

  return clusters;
}

function askYesNo(question: string): boolean {
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const isNonInteractive = process.env.RITSU_NON_INTERACTIVE === "1";
  if (isTest || isNonInteractive) {
    return true; // Auto-approve in non-interactive/test environments
  }

  process.stdout["write"](`${question} (y/N): `);
  const buffer = Buffer.alloc(16);
  try {
    const bytesRead = readSync(0, buffer, 0, 16, null);
    const response = buffer.toString("utf8", 0, bytesRead).trim().toLowerCase();
    return response === "y" || response === "yes";
  } catch {
    return false;
  }
}

function parseHunksFromDiff(diff: string): { pre: string; post: string }[] {
  const hunks: { pre: string; post: string }[] = [];
  const lines = diff.split(/\r?\n/);
  
  let preAccumulator: string[] = [];
  let postAccumulator: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      if (inHunk && (preAccumulator.length > 0 || postAccumulator.length > 0)) {
        hunks.push({
          pre: preAccumulator.join("\n"),
          post: postAccumulator.join("\n"),
        });
        preAccumulator = [];
        postAccumulator = [];
      }
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      if (inHunk && (preAccumulator.length > 0 || postAccumulator.length > 0)) {
        hunks.push({
          pre: preAccumulator.join("\n"),
          post: postAccumulator.join("\n"),
        });
      }
      preAccumulator = [];
      postAccumulator = [];
      inHunk = true;
      continue;
    }

    if (inHunk) {
      if (line.startsWith("-")) {
        preAccumulator.push(line.slice(1));
      } else if (line.startsWith("+")) {
        postAccumulator.push(line.slice(1));
      } else {
        const content = line.startsWith(" ") ? line.slice(1) : line;
        preAccumulator.push(content);
        postAccumulator.push(content);
      }
    }
  }

  if (inHunk && (preAccumulator.length > 0 || postAccumulator.length > 0)) {
    hunks.push({
      pre: preAccumulator.join("\n"),
      post: postAccumulator.join("\n"),
    });
  }

  return hunks;
}

function collectNodes(node: ts.Node, kind: ts.SyntaxKind): ts.Node[] {
  const nodes: ts.Node[] = [];
  function traverse(n: ts.Node) {
    if (n.kind === kind) {
      nodes.push(n);
    }
    ts.forEachChild(n, traverse);
  }
  traverse(node);
  return nodes;
}

function analyzeHunkAST(preCode: string, postCode: string): PreferenceRule[] {
  const rules: PreferenceRule[] = [];
  
  try {
    const preSource = ts.createSourceFile("pre.ts", preCode, ts.ScriptTarget.Latest, true);
    const postSource = ts.createSourceFile("post.ts", postCode, ts.ScriptTarget.Latest, true);

    // 1. Let to Const
    const preVars = collectNodes(preSource, ts.SyntaxKind.VariableDeclarationList) as ts.VariableDeclarationList[];
    const postVars = collectNodes(postSource, ts.SyntaxKind.VariableDeclarationList) as ts.VariableDeclarationList[];

    const preHasLet = preVars.some(v => !(v.flags & ts.NodeFlags.Const));
    const postHasConst = postVars.some(v => !!(v.flags & ts.NodeFlags.Const));
    if (preHasLet && postHasConst) {
      const preNames = new Set(preVars.flatMap(v => v.declarations.map(d => d.name.getText())));
      const postNames = new Set(postVars.flatMap(v => v.declarations.map(d => d.name.getText())));
      const intersection = [...preNames].filter(x => postNames.has(x));
      if (intersection.length > 0) {
        rules.push({
          id: "pref-prefer-const",
          match_regex: "\\blet\\s+\\w+\\s*=",
          scope: "coding_style",
          auto_inject_to: ["think", "dev"],
          message: "Prefer const over let for variables that are never reassigned",
        });
      }
    }

    // 2. Loose to Strict Equality (== to === or != to !==)
    const preBinary = collectNodes(preSource, ts.SyntaxKind.BinaryExpression) as ts.BinaryExpression[];
    const postBinary = collectNodes(postSource, ts.SyntaxKind.BinaryExpression) as ts.BinaryExpression[];

    const preHasLoose = preBinary.some(b => 
      b.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || 
      b.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    );
    const postHasStrict = postBinary.some(b => 
      b.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || 
      b.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    );
    if (preHasLoose && postHasStrict) {
      rules.push({
        id: "pref-strict-equality",
        match_regex: "(?<!!)={2}(?!=)|(?<![!=>])!=(?!=)",
        scope: "type_safety",
        auto_inject_to: ["think", "dev"],
        message: "Use strict equality (=== / !==) instead of loose equality (== / !=)",
      });
    }

    // 3. Function declaration to arrow function expression
    const preFuncs = collectNodes(preSource, ts.SyntaxKind.FunctionDeclaration) as ts.FunctionDeclaration[];
    const postArrows = collectNodes(postSource, ts.SyntaxKind.ArrowFunction) as ts.ArrowFunction[];
    if (preFuncs.length > 0 && postArrows.length > 0) {
      const preFuncNames = new Set(
        preFuncs
          .map(f => f.name?.getText())
          .filter((name): name is string => typeof name === "string")
      );
      const postVarNames = new Set(postVars.flatMap(v => v.declarations.map(d => d.name.getText())));
      const intersection = [...preFuncNames].filter(x => postVarNames.has(x));
      if (intersection.length > 0) {
        rules.push({
          id: "pref-arrow-function",
          match_regex: "function\\s+\\w+\\s*\\([^)]*\\)\\s*\\{",
          scope: "coding_style",
          auto_inject_to: ["dev"],
          message: "Use arrow function expressions instead of function declarations for callbacks",
        });
      }
    }

    // 4. Template literal over string concatenation
    const preConcat = preBinary.some(b => b.operatorToken.kind === ts.SyntaxKind.PlusToken);
    const postTemplate = collectNodes(postSource, ts.SyntaxKind.TemplateExpression).length > 0 || 
                         collectNodes(postSource, ts.SyntaxKind.NoSubstitutionTemplateLiteral).length > 0;
    if (preConcat && postTemplate) {
      rules.push({
        id: "pref-template-literal",
        match_regex: "'[\"']\\s*\\+\\s*\\w+\\s*\\+\\s*['\"]",
        scope: "coding_style",
        auto_inject_to: ["dev"],
        message: "Use template literals (`...`) instead of string concatenation",
      });
    }

    // 5. Async/await over Promises (.then() to await)
    const preCalls = collectNodes(preSource, ts.SyntaxKind.CallExpression) as ts.CallExpression[];
    const postAwait = collectNodes(postSource, ts.SyntaxKind.AwaitExpression).length > 0;
    const preHasThen = preCalls.some(c => {
      const exp = c.expression;
      return ts.isPropertyAccessExpression(exp) && exp.name.getText() === "then";
    });
    if (preHasThen && postAwait) {
      rules.push({
        id: "pref-async-await",
        match_regex: "\\.then\\s*\\(",
        scope: "performance",
        auto_inject_to: ["dev"],
        message: "Prefer async/await over .then() chains for better readability",
      });
    }
  } catch (err) {
    // Parser error on snippet, ignore
  }

  return rules;
}

export function extractHeuristicRules(
  corrections: Array<{ file: string; diff: string }>,
): PreferenceRule[] {
  if (corrections.length === 0) return [];

  const clusters = clusterCorrections(corrections);
  const suggested: PreferenceRule[] = [];
  const seenIds = new Set<string>();

  // 1. AST Diff extraction using TS Compiler API
  for (const correction of corrections) {
    if (/\.(ts|tsx|js|jsx)$/.test(correction.file)) {
      const hunks = parseHunksFromDiff(correction.diff);
      for (const hunk of hunks) {
        const astRules = analyzeHunkAST(hunk.pre, hunk.post);
        for (const rule of astRules) {
          if (seenIds.has(rule.id)) continue;
          
          const clusterCount = clusters.get(correction.file) ?? 1;
          const confidence = 0.8 + (clusterCount - 1) * 0.1;
          
          if (confidence >= 0.7) {
            seenIds.add(rule.id);
            suggested.push(rule);
          }
        }
      }
    }
  }

  // 2. Standard regex heuristic patterns as complement
  for (const correction of corrections) {
    for (const pattern of HEURISTIC_PATTERNS) {
      if (!pattern.test(correction.diff)) continue;
      if (seenIds.has(pattern.name) || seenIds.has(`pref-${pattern.name}`)) continue;

      const clusterCount = clusters.get(correction.file) ?? 1;
      const effectiveConfidence = Math.min(1, pattern.confidence + (clusterCount - 1) * 0.1);

      if (effectiveConfidence >= 0.7) {
        const rule = pattern.build();
        seenIds.add(pattern.name);
        seenIds.add(rule.id);
        suggested.push(rule);
      }
    }
  }

  return suggested;
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
      // Prompt user with full details of the rule (HITL)
      console.log(`\nProposed Preference Rule Found:`);
      console.log(`---------------------------------`);
      console.log(`ID:            ${promotedRule.id}`);
      console.log(`Match Regex:   ${promotedRule.match_regex}`);
      console.log(`Scope:         ${promotedRule.scope}`);
      console.log(`Auto Inject:   ${JSON.stringify(promotedRule.auto_inject_to)}`);
      console.log(`Message:       ${promotedRule.message}`);
      console.log(`---------------------------------`);

      if (!askYesNo(`Do you want to promote this rule to '.ritsu/preferences.yaml'?`)) {
        console.log(`❌ Promotion of preference rule '${prefId}' was cancelled by user.`);
        return false;
      }

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
        console.log(`✅ Preference rule '${prefId}' is already in preferences.yaml.`);
        return true;
      }

      currentRules.push(promotedRule);
      writeFileSync(prefPath, yaml.dump({ rules: currentRules }), "utf-8");
      reconcilePreferences();
      console.log(`✅ Preference rule '${prefId}' promoted successfully.`);
      return true;
    }
  }

  return false;
}

export async function autoApplyMinedRules(days: number): Promise<{ addedCount: number; rules: PreferenceRule[] }> {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);
  const prefPath = resolve(root, ".ritsu/preferences.yaml");

  if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });

  const { corrections, violations } = scanHumanCorrections(root, days);

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

  // Phase 1: Heuristic rule extraction (always available, no LLM needed)
  const heuristicRules = extractHeuristicRules(corrections);

  // Phase 2: LLM-Driven preference rules synthesis (when RITSU_LLM_ENABLED=1)
  const llmRules = await synthesizeWithLLM({
    corrections,
    violations,
    existingRules: currentRules,
  });

  // Merge: heuristic rules take precedence (higher specificity), LLM fills gaps
  const candidateRules = [
    ...heuristicRules,
    ...llmRules.filter((lr) => !heuristicRules.some((hr) => hr.id === lr.id)),
  ];

  let addedCount = 0;
  for (const syn of candidateRules) {
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
    rules: candidateRules
  };
}

