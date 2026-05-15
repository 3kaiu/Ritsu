#!/usr/bin/env node
/**
 * Ritsu Version Consistency Checker
 *
 * 用法：
 *   node version-check.js           # 校验全仓库版本一致性，不一致退出非零
 *   node version-check.js --write   # 把所有不一致的文件同步到 package.json 的 ritsu_protocol_version
 *
 * 单一事实来源: runtime/package.json 的 ritsu_protocol_version
 * 引用了该版本的所有文件类型见下方 targets 数组。
 *
 * S1.1 落地：解决 README/CHANGELOG/AGENTS.md/skills/_shared/domains/rules 版本漂移问题。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);
const expected = pkg.ritsu_protocol_version || pkg.version;

if (!expected) {
  console.error("✖ package.json: ritsu_protocol_version or version missing");
  process.exit(1);
}

/**
 * Target 描述: 在哪个文件里、用什么正则、找到哪一组捕获 = 版本号
 * - global: true 时使用 matchAll 处理多处出现（如 marketplace.json 的 plugin.version）
 * - optional: true 时文件不存在不算 fail
 */
const targets = [
  // 协议 schema 描述里的 v5.2.0
  { file: "_shared/ctx-event-schema.json", pattern: /"v(\d+\.\d+\.\d+) — / },

  // SKILL.md frontmatter
  ...["init", "think", "dev", "hunt", "review", "freestyle"].map((s) => ({
    file: `skills/${s}/SKILL.md`,
    pattern: /version:\s*"(\d+\.\d+\.\d+)"/,
  })),

  // _shared 顶部注释/标题
  {
    file: "_shared/mcp-tools.yaml",
    pattern: /MCP Tool Schema 声明 v(\d+\.\d+\.\d+)/,
  },
  {
    file: "_shared/preferences-schema.yaml",
    pattern: /用户偏好 Schema v(\d+\.\d+\.\d+)/,
  },
  {
    file: "_shared/skill-common-steps.md",
    pattern: /公共步骤模板 v(\d+\.\d+\.\d+)/,
  },
  { file: "_shared/artifact-templates.md", pattern: /主产物模板 v(\d+\.\d+\.\d+)/ },
  { file: "_shared/artifact-schema.yaml", pattern: /产物契约 v(\d+\.\d+\.\d+)/ },

  // domains 顶部注释
  ...["_base", "infra", "backend", "frontend", "fullstack", "data"].map(
    (d) => ({
      file: `domains/${d}.yaml`,
      pattern: /^# Domain:[^\n]* v(\d+\.\d+\.\d+)/m,
    }),
  ),

  // rules
  {
    file: "rules/anti-patterns.yaml",
    pattern: /Anti-Patterns:[^\n]* v(\d+\.\d+\.\d+)/,
  },

  // handlers/index.ts jsdoc
  {
    file: "runtime/src/handlers/index.ts",
    pattern: /Handler 注册表 v(\d+\.\d+\.\d+)/,
  },

  // README.md badge
  { file: "README.md", pattern: /badge\/version-(\d+\.\d+\.\d+)-/ },

  // AGENTS.md
  { file: "AGENTS.md", pattern: /ritsu-version:\s*(\d+\.\d+\.\d+)/ },

  // marketplace.json — 多处 plugin.version
  {
    file: ".claude-plugin/marketplace.json",
    pattern: /"version":\s*"(\d+\.\d+\.\d+)"/g,
    global: true,
  },

  // runtime/package.json 的 version 字段本身也对齐（防止 version != ritsu_protocol_version）
  { file: "runtime/package.json", pattern: /"version":\s*"(\d+\.\d+\.\d+)"/ },
];

const mismatches = [];
const writes = [];

for (const t of targets) {
  const absPath = path.join(projectRoot, t.file);
  if (!fs.existsSync(absPath)) {
    if (t.optional) continue;
    mismatches.push({ file: t.file, found: "<file missing>", expected });
    continue;
  }

  let content = fs.readFileSync(absPath, "utf8");

  if (t.global) {
    const matches = [...content.matchAll(t.pattern)];
    if (matches.length === 0) {
      mismatches.push({ file: t.file, found: "<no version marker>", expected });
      continue;
    }
    const bad = matches.filter((m) => m[1] !== expected);
    if (bad.length > 0) {
      mismatches.push({
        file: t.file,
        found: [...new Set(bad.map((m) => m[1]))].join(", "),
        expected,
      });
      if (WRITE) {
        content = content.replace(t.pattern, (full, ver) =>
          full.replace(ver, expected),
        );
        fs.writeFileSync(absPath, content);
        writes.push(t.file);
      }
    }
  } else {
    const m = content.match(t.pattern);
    if (!m) {
      mismatches.push({ file: t.file, found: "<no version marker>", expected });
      continue;
    }
    if (m[1] !== expected) {
      mismatches.push({ file: t.file, found: m[1], expected });
      if (WRITE) {
        content = content.replace(t.pattern, (full) =>
          full.replace(m[1], expected),
        );
        fs.writeFileSync(absPath, content);
        writes.push(t.file);
      }
    }
  }
}

if (WRITE && writes.length > 0) {
  console.log(`✓ Synced ${writes.length} files to version ${expected}:`);
  writes.forEach((f) => console.log(`  - ${f}`));
  process.exit(0);
}

if (mismatches.length > 0) {
  console.error(`✖ Version mismatch (expected ${expected}):`);
  for (const m of mismatches) {
    console.error(`  - ${m.file}: ${m.found}`);
  }
  console.error(`\nHint: node version-check.js --write   to auto-sync`);
  process.exit(1);
}

console.log(`✓ All versions aligned to ${expected}`);
