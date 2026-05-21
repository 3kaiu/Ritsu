/**
 * LLM 驱动规则合成器
 *
 * 将人类修正数据发送到外部 LLM API，让 LLM 分析模式并生成偏好规则。
 * 支持 OpenAI 兼容 API 格式。
 *
 * 配置 (环境变量):
 *   RITSU_LLM_ENDPOINT — API 端点 (默认: https://api.openai.com/v1/chat/completions)
 *   RITSU_LLM_API_KEY — API 密钥 (默认: 无)
 *   RITSU_LLM_MODEL — 模型名称 (默认: gpt-4o-mini)
 *   RITSU_LLM_ENABLED — 设为 '1' 启用 LLM 合成 (默认: '0')
 */

import yaml from "js-yaml";
import type { PreferenceRule } from "./miner.js";

interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

function getConfig(): LLMConfig {
  return {
    endpoint: process.env.RITSU_LLM_ENDPOINT ?? "https://api.openai.com/v1/chat/completions",
    apiKey: process.env.RITSU_LLM_API_KEY ?? "",
    model: process.env.RITSU_LLM_MODEL ?? "gpt-4o-mini",
    enabled: process.env.RITSU_LLM_ENABLED === "1",
  };
}

interface SynthesisInput {
  corrections: Array<{ file: string; diff: string }>;
  violations: Array<{
    rule_id?: string;
    skill?: string;
    message?: string;
    evidence?: string;
  }>;
  existingRules: PreferenceRule[];
}

/**
 * 使用 LLM 合成偏好规则。
 * 当 LLM 不可用或返回无效结果时返回空数组。
 */
export async function synthesizeWithLLM(
  input: SynthesisInput,
): Promise<PreferenceRule[]> {
  const config = getConfig();
  if (!config.enabled) return [];
  if (!config.apiKey) {
    console.warn("[ritsu-llm] RITSU_LLM_API_KEY not set, skipping LLM synthesis");
    return [];
  }

  const prompt = buildSynthesisPrompt(input);

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
          {
            role: "system",
            content: `You are Ritsu's preference mining engine. Analyze human corrections to code written by AI, and synthesize preference rules that prevent similar issues.
Output ONLY valid YAML (no markdown fences, no explanatory text).
Each rule must have: id, match_regex, scope (coding_style|type_safety|performance|architecture|naming_convention), auto_inject_to array, and message.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      console.warn(`[ritsu-llm] API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    return parseLLMResponse(content);
  } catch (e) {
    console.warn(`[ritsu-llm] Request failed:`, e);
    return [];
  }
}

function buildSynthesisPrompt(input: SynthesisInput): string {
  const parts: string[] = [
    `# Human Corrections Analysis`,
    `Analyze the following human edits to AI-written code and extract coding preference rules.`,
    ``,
    `## Existing Rules Already Applied`,
    JSON.stringify(input.existingRules.map((r) => ({ id: r.id, scope: r.scope })), null, 2),
    ``,
  ];

  for (const c of input.corrections.slice(0, 10)) {
    parts.push(`## File: ${c.file}`);
    parts.push("```diff");
    parts.push(c.diff.slice(0, 2000)); // Truncate large diffs
    parts.push("```");
    parts.push("");
  }

  if (input.violations.length > 0) {
    parts.push(`## Recent Policy Violations`);
    for (const v of input.violations.slice(0, 20)) {
      parts.push(`- Rule: ${v.rule_id ?? "unknown"} | Skill: ${v.skill ?? "unknown"}`);
      if (v.message) parts.push(`  Message: ${v.message}`);
      if (v.evidence) parts.push(`  Evidence: ${v.evidence}`);
    }
    parts.push("");
  }

  parts.push(`Generate preference rules in this exact YAML format:`);
  parts.push(`- id: pref-unique-identifier`);
  parts.push(`  match_regex: "regex pattern to match"`);
  parts.push(`  scope: coding_style`);
  parts.push(`  auto_inject_to: [think, dev]`);
  parts.push(`  message: "Description of what to do instead"`);

  return parts.join("\n");
}

function parseLLMResponse(content: string): PreferenceRule[] {
  // Strip markdown fences if present
  const cleaned = content
    .replace(/^```ya?ml\s*/m, "")
    .replace(/^```\s*$/m, "")
    .trim();

  try {
    const parsed = yaml.load(cleaned) as unknown;
    if (!parsed) return [];

    const rules = Array.isArray(parsed) ? parsed : [parsed];
    return rules.filter((r): r is PreferenceRule => {
      return (
        typeof r === "object" &&
        r !== null &&
        typeof (r as Record<string, unknown>).id === "string" &&
        typeof (r as Record<string, unknown>).match_regex === "string" &&
        String((r as Record<string, unknown>).id).length > 0
      );
    });
  } catch {
    console.warn("[ritsu-llm] Failed to parse LLM response as YAML");
    return [];
  }
}
