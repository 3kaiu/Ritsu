import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

interface CoverageMetric {
  covered: number;
}

interface CoverageStats {
  lines?: CoverageMetric;
}

interface StoredCoverage {
  per_file: Record<string, CoverageStats>;
}

interface StoredQualityGate {
  coverage?: StoredCoverage;
}

interface ContractRecord {
  id: string;
  description: string;
  test_file_hint: string;
}

type PartialContractRecord = Partial<ContractRecord>;

function hasCoveredLines(stats: CoverageStats): boolean {
  return typeof stats.lines?.covered === "number" && stats.lines.covered > 0;
}

function isCompleteContract(contract: PartialContractRecord | null): contract is ContractRecord {
  return Boolean(contract?.id && contract.description && contract.test_file_hint);
}

export class ContractCoverageDetector implements DetectorPlugin {
  type = "contract_coverage" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Trigger on write_artifact of dev-report or assurance-sheet
    if (ctx.action !== "write_artifact") return violations;
    if (!ctx.target?.includes("dev-report") && !ctx.target?.includes("assurance-sheet")) {
      return violations;
    }

    const root = getProjectRoot();
    const lastGatePath = resolve(root, ".ritsu/last-quality-gate.json");
    
    if (!existsSync(lastGatePath)) {
      return violations; // Can't check without coverage data
    }

    let lastGate: StoredQualityGate;
    try {
      lastGate = JSON.parse(readFileSync(lastGatePath, "utf-8")) as StoredQualityGate;
    } catch {
      return violations;
    }

    const coverage = lastGate.coverage;
    if (!coverage || !coverage.per_file) {
      return violations;
    }

    const designSheetPath = this.findLatestDesignSheet(root);
    if (!existsSync(designSheetPath)) {
      return violations;
    }

    const content = readFileSync(designSheetPath, "utf-8");
    const contracts = this.parseContracts(content);

    for (const contract of contracts) {
      const hint = contract.test_file_hint;
      if (!hint) continue;

      // Check if the hint file has coverage in lastGate
      let covered = false;
      for (const [file, stats] of Object.entries(coverage.per_file)) {
        if (file.includes(hint) || hint.includes(file)) {
          // Check if lines/functions are covered
          if (hasCoveredLines(stats)) {
            covered = true;
            break;
          }
        }
      }

      if (!covered) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Contract '${contract.id}' (${contract.description}) has no confirmed test coverage in hinted file '${hint}'.`,
          evidence: `Contract ID: ${contract.id}`,
          suggestion: `Implement a test case for contract '${contract.id}' in '${hint}' and run quality gates.`,
        });
      }
    }

    return violations;
  }

  private findLatestDesignSheet(root: string): string {
    const artifactDir = resolve(root, ".ritsu");
    if (existsSync(artifactDir)) {
      const files = readdirSync(artifactDir)
        .filter((file) => file.startsWith("design-sheet-") && file.endsWith(".md"));
      
      if (files.length > 0) {
        const stats = files.map((file) => {
          const fullPath = resolve(artifactDir, file);
          return {
            path: fullPath,
            mtime: statSync(fullPath).mtimeMs,
          };
        });
        stats.sort((a, b) => {
          if (b.mtime !== a.mtime) {
            return b.mtime - a.mtime;
          }
          return b.path.localeCompare(a.path);
        });
        return stats[0].path;
      }
    }

    return resolve(root, "docs/design-sheet.md");
  }

  private parseContracts(content: string): ContractRecord[] {
    const contracts: ContractRecord[] = [];
    const lines = content.split("\n");

    let current: PartialContractRecord | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const idMatch = line.match(/^-?\s*id:\s*(.+)$/);
      if (idMatch) {
        if (isCompleteContract(current)) {
          contracts.push(current);
        }
        current = { id: idMatch[1].trim() };
        continue;
      }
      const descriptionMatch = line.match(/^description:\s*(.+)$/);
      if (descriptionMatch && current) {
        current.description = descriptionMatch[1].trim();
        continue;
      }
      const hintMatch = line.match(/^test_file_hint:\s*(.+)$/);
      if (hintMatch && current) {
        current.test_file_hint = hintMatch[1].trim().replace(/`/g, "");
      }
    }
    if (isCompleteContract(current)) {
      contracts.push(current);
    }

    if (contracts.length > 0) {
      return contracts;
    }

    const tableContracts: ContractRecord[] = [];
    let inTable = false;
    for (const line of lines) {
      if (line.includes("| ID |") && line.includes("|")) {
        inTable = true;
        continue;
      }
      if (inTable && line.startsWith("| ---")) continue;
      if (inTable && line.startsWith("|")) {
        const parts = line
          .split("|")
          .map((part) => part.trim())
          .filter(Boolean);
        if (parts.length >= 3) {
          tableContracts.push({
            id: parts[0],
            description: parts[1],
            test_file_hint: parts[2].replace(/`/g, ""),
          });
        }
      }
    }
    return tableContracts;
  }
}
