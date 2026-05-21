import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type OpenSpecContract = {
  id: string;
  description: string;
  test_file_hint: string;
  openspec_ref: string;
};

export type SyncOpenSpecResult = {
  change_id: string;
  contracts: OpenSpecContract[];
  design_sheet_path: string;
  openspec_proposal_path: string;
};

function listChangeDirs(openspecRoot: string): string[] {
  const changesDir = join(openspecRoot, "changes");
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function pickChangeId(openspecRoot: string, requested?: string): string | null {
  const dirs = listChangeDirs(openspecRoot);
  if (dirs.length === 0) return null;
  if (requested && dirs.includes(requested)) return requested;

  let latest: { id: string; mtime: number } | null = null;
  for (const id of dirs) {
    const proposal = join(openspecRoot, "changes", id, "proposal.md");
    if (!existsSync(proposal)) continue;
    const mtime = statSync(proposal).mtimeMs;
    if (!latest || mtime > latest.mtime) latest = { id, mtime };
  }
  return latest?.id ?? dirs[0] ?? null;
}

/** Extract requirement-like bullets from OpenSpec proposal markdown */
export function extractContractsFromProposal(
  proposalMarkdown: string,
  changeId: string,
): OpenSpecContract[] {
  const contracts: OpenSpecContract[] = [];
  const lines = proposalMarkdown.split("\n");
  let section = "";

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      section = heading[1].toLowerCase();
    }

    const bullet = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)/);
    const reqTag = line.match(/^\s*(?:REQ|Requirement)[-:\s]+(.+)/i);

    const text = bullet?.[1] ?? numbered?.[1] ?? reqTag?.[1];
    if (!text || text.length < 8) continue;

    const inReqSection =
      section.includes("requirement") ||
      section.includes("scope") ||
      section.includes("goal") ||
      section.includes("acceptance");

    if (!inReqSection && !reqTag && !bullet) continue;

    const n = contracts.length + 1;
    const id = `OS-${changeId}-${n}`;
    contracts.push({
      id,
      description: text.trim(),
      test_file_hint: `openspec/changes/${changeId}/`,
      openspec_ref: `proposal.md#L${contracts.length + 1}`,
    });
  }

  if (contracts.length === 0) {
    const summary = proposalMarkdown
      .replace(/^#+\s+/gm, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 20);
    if (summary) {
      contracts.push({
        id: `OS-${changeId}-1`,
        description: summary.slice(0, 240),
        test_file_hint: `openspec/changes/${changeId}/`,
        openspec_ref: "proposal.md",
      });
    }
  }

  return contracts;
}

export function buildMinimalDesignSheet(
  changeId: string,
  contracts: OpenSpecContract[],
  proposalPath: string,
): string {
  const rows = contracts
    .map(
      (c) =>
        `| ${c.id} | ${c.description.replace(/\|/g, "\\|")} | \`${c.test_file_hint}\` |`,
    )
    .join("\n");

  return `# Design Sheet (设计单) — OpenSpec Bridge

> Auto-synced from \`${proposalPath}\`. Full narrative lives in OpenSpec; Ritsu machine checks use contracts below.

## 1. 任务识别 (Intake)
- 任务类型: 新功能
- 当前目标: OpenSpec change \`${changeId}\`
- 风险等级: critical
- OpenSpec Change: \`openspec/changes/${changeId}/\`

## 6. 实施清单 (Execution)
- 验证计划:
  - 测试命令: 见 OpenSpec tasks + 项目 test 脚本
  - 契约验证 (Contracts):
    | ID | 契约描述 | 测试断言位置 |
    | --- | --- | --- |
${rows || "| OS-placeholder | See OpenSpec proposal | `openspec/changes/" + changeId + "/` |"}

---
## 下一步
运行 \`/r-dev\`；验收时 \`design.contracts\` 与 OpenSpec specs 双向对账。
`;
}

/**
 * /opsx: 命令检测 — 检查 OpenSpec 是否支持 /opsx: 工作流
 */
export function hasOpsxWorkflow(root: string): boolean {
  const configPath = resolve(root, "openspec", "config.yaml");
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, "utf-8");
    return content.includes("opsx") || content.includes("profile");
  } catch {
    return false;
  }
}

/**
 * 解析 /opsx: 命令的执行产物路径
 */
export function resolveOpsxArtifact(
  root: string,
  command: string,
  changeName: string,
): string | null {
  const base = resolve(root, "openspec", "changes", changeName);
  const mapping: Record<string, string> = {
    propose: "proposal.md",
    "writing-plans": "tasks.md",
    design: "design.md",
    specs: "specs",
  };
  const relPath = mapping[command];
  if (!relPath) return null;
  const fullPath = join(base, relPath);
  return existsSync(fullPath) ? fullPath : null;
}

export function syncOpenSpecContracts(
  projectRoot: string,
  changeIdParam?: string,
): SyncOpenSpecResult | { error: string } {
  const openspecRoot = resolve(projectRoot, "openspec");
  if (!existsSync(openspecRoot)) {
    return { error: "openspec/ directory not found; run openspec init first" };
  }

  const changeId = pickChangeId(openspecRoot, changeIdParam?.trim() || undefined);
  if (!changeId) {
    return { error: "no openspec/changes/<id> directories found" };
  }

  // Support /opsx: 目录结构: proposal.md
  const proposalPath = join(openspecRoot, "changes", changeId, "proposal.md");
  const opsxProposalPath = join(openspecRoot, "changes", changeId, "proposal.md");
  if (!existsSync(proposalPath)) {
    return { error: `proposal not found: ${proposalPath}` };
  }

  const proposalMarkdown = readFileSync(proposalPath, "utf-8");
  const contracts = extractContractsFromProposal(proposalMarkdown, changeId);
  const relProposal = `openspec/changes/${changeId}/proposal.md`;
  const content = buildMinimalDesignSheet(changeId, contracts, relProposal);

  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) mkdirSync(ritsuDir, { recursive: true });

  const filename = `design-sheet-openspec-${changeId}.md`;
  const designSheetPath = join(ritsuDir, filename);
  writeFileSync(designSheetPath, content, "utf-8");

  return {
    change_id: changeId,
    contracts,
    design_sheet_path: `.ritsu/${filename}`,
    openspec_proposal_path: relProposal,
  };
}
