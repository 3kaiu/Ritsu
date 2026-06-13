import { getConfig } from "../llm-synthesizer.js";
import { readAllEntries } from "../ctx-reader.js";
import { getProjectRoot } from "../handlers/_utils.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SkillPerformance {
  skill: string;
  version: string;
  totalRuns: number;
  passRate: number;
  avgTokens: number;
  avgDuration: number;
  topFailurePatterns: string[];
  lastOptimized: string;
}

export interface SkillOptConfig {
  textualLearningRate: number;     // max edit ops per step (default 4)
  validationThreshold: number;     // min improvement % to accept (default 5)
  rejectedEditBufferSize: number;  // how many failed edits to remember (default 50)
  minSampleSize: number;           // min executions before optimizing (default 10)
}

function getOptimizerDir(root: string): string {
  const dir = resolve(root, ".ritsu", "skill-optimizer");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getRejectedEditsPath(root: string): string {
  return resolve(getOptimizerDir(root), "rejected-edits.jsonl");
}

function loadRejectedEdits(root: string): string[] {
  const path = getRejectedEditsPath(root);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l).proposal as string);
  } catch {
    return [];
  }
}

function addRejectedEdit(root: string, proposal: string): void {
  const path = getRejectedEditsPath(root);
  const entry = JSON.stringify({ ts: new Date().toISOString(), proposal });
  appendFileSync(path, entry + "\n", "utf-8");
}

async function askLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = getConfig();
  if (!config.enabled || !config.apiKey) {
    console.warn("[ritsu-optimizer] LLM not enabled or API key missing, skipping LLM optimization.");
    return "";
  }

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) return "";
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("[ritsu-optimizer] LLM request failed:", err);
    return "";
  }
}

/**
 * Forward Pass: Read historical traces from ctx logs and analyze performance.
 */
export function analyzeSkillPerformance(projectRoot: string, skill: string): SkillPerformance {
  const events = readAllEntries(projectRoot);
  const relevantEvents = events.filter((e: any) => e.skill === skill);

  let starts = 0;
  let successes = 0;
  let failures = 0;
  let totalTokens = 0;
  let totalDuration = 0;
  const failureReasons: string[] = [];

  // Group events by correlation_id to calculate run performance
  const traces = new Map<string, { ok?: boolean; tokens: number; duration: number; errors: string[] }>();

  for (const evt of relevantEvents as any[]) {
    const tid = evt.trace_id || evt.correlation_id;
    if (!tid) continue;

    const current = traces.get(tid) || { tokens: 0, duration: 0, errors: [] };
    if (evt.status === "started") {
      starts++;
    } else if (evt.status === "done") {
      successes++;
      current.ok = true;
    } else if (evt.status === "failed") {
      failures++;
      current.ok = false;
      if (evt.error) current.errors.push(evt.error);
    }

    if (evt.token_estimate) {
      current.tokens += evt.token_estimate;
    }
    if (evt.duration_ms) {
      current.duration += evt.duration_ms;
    }
    traces.set(tid, current);
  }

  const traceList = [...traces.values()];
  const totalRuns = traceList.length;
  const passRate = totalRuns > 0 ? (traceList.filter(t => t.ok).length / totalRuns) * 100 : 100;
  
  traceList.forEach(t => {
    totalTokens += t.tokens;
    totalDuration += t.duration;
    failureReasons.push(...t.errors);
  });

  return {
    skill,
    version: "1.0.0", // default placeholder
    totalRuns,
    passRate,
    avgTokens: totalRuns > 0 ? totalTokens / totalRuns : 0,
    avgDuration: totalRuns > 0 ? totalDuration / totalRuns : 0,
    topFailurePatterns: failureReasons.slice(0, 10),
    lastOptimized: new Date().toISOString(),
  };
}

/**
 * Backward Pass & Bounded Edits: Propose skill modifications using Textual Gradient Descent.
 */
export async function proposeSkillOptimization(
  projectRoot: string,
  skillName: string,
  skillContent: string,
  performance: SkillPerformance,
  config: SkillOptConfig,
): Promise<{ proposal: string; changes: string } | null> {
  if (performance.totalRuns < config.minSampleSize) {
    console.warn(`[ritsu-optimizer] Insufficient sample size for ${skillName} (${performance.totalRuns} < ${config.minSampleSize}).`);
    return null;
  }

  const systemPrompt = `You are a meta-learning optimizer applying Textual Gradient Descent to improve an AI agent's skill instruction file (SKILL.md).
Analyze the success/failure history, identify failure patterns, and propose bounded edits to the SKILL.md.

RULES:
1. You are restricted by a Textual Learning Rate of <= ${config.textualLearningRate} edit operations (adds/deletes/replacements).
2. Focus on fixing high-frequency failures while maintaining overall performance (avoid negative transfer).
3. Output a JSON block matching:
{
  "proposed_skill": "Full contents of the new SKILL.md file",
  "explanation_of_changes": "List of the <= ${config.textualLearningRate} edits made and why"
}`;

  const userPrompt = `Current SKILL.md contents:
\`\`\`markdown
${skillContent}
\`\`\`

Historical Performance Metrics:
- Pass Rate: ${performance.passRate.toFixed(1)}%
- Avg Tokens: ${performance.avgTokens.toFixed(0)}
- Top Failure Patterns:
${performance.topFailurePatterns.map((p, idx) => `${idx + 1}. ${p}`).join("\n")}

Please propose optimized skill instructions.`;

  const responseText = await askLLM(systemPrompt, userPrompt);
  if (!responseText) return null;

  try {
    // Clean markdown block if LLM returned it
    const jsonStr = responseText.replace(/```json\s*|```/g, "").trim();
    const result = JSON.parse(jsonStr);
    
    // Check rejected edits buffer to prevent repeating failed ideas
    const rejected = loadRejectedEdits(projectRoot);
    if (rejected.includes(result.proposed_skill)) {
      console.warn(`[ritsu-optimizer] Proposed skill matches an entry in the rejected edits buffer. Discarding.`);
      return null;
    }

    return {
      proposal: result.proposed_skill,
      changes: result.explanation_of_changes,
    };
  } catch (err) {
    console.error("[ritsu-optimizer] Failed to parse LLM optimization response:", err);
    return null;
  }
}

/**
 * Validation Gate: Simulates a dry-run test of the proposed skill.
 * Requires at least validationThreshold% improvement or no regression on failure cases.
 */
export async function validateSkillProposal(
  projectRoot: string,
  performance: SkillPerformance,
  proposal: { proposal: string; changes: string },
  config: SkillOptConfig,
): Promise<boolean> {
  const systemPrompt = `You are an evaluation simulator. Compare the old and new proposed version of a SKILL.md instruction file.
Review the historical failure patterns and decide if the new version is highly likely to fix them without breaking anything else.

Output JSON:
{
  "will_improve": true/false,
  "confidence_score": 0-100,
  "reasoning": "Explanation"
}`;

  const userPrompt = `Historical failures:
${performance.topFailurePatterns.join("\n")}

Old version:
${performance.skill}

New version:
${proposal.proposal}

Edits:
${proposal.changes}`;

  const responseText = await askLLM(systemPrompt, userPrompt);
  if (!responseText) {
    // Graceful fallback for offline / no LLM: accept proposal if it's not empty
    return true;
  }

  try {
    const jsonStr = responseText.replace(/```json\s*|```/g, "").trim();
    const result = JSON.parse(jsonStr);
    
    if (result.will_improve && result.confidence_score >= 70) {
      return true;
    }
    
    // If validation fails, write to rejected buffer
    addRejectedEdit(projectRoot, proposal.proposal);
    return false;
  } catch {
    return true; // fallback
  }
}
