import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

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

    let lastGate: any;
    try {
      lastGate = JSON.parse(readFileSync(lastGatePath, "utf-8"));
    } catch {
      return violations;
    }

    const coverage = lastGate.coverage;
    if (!coverage || !coverage.per_file) {
      return violations;
    }

    // Try to find design-sheet contracts
    // In a real scenario, this would be passed in ctx.context.contracts
    // For now, let's try to find the latest design-sheet.md
    const designSheetPath = resolve(root, "docs/design-sheet.md");
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
          const s = stats as any;
          if (s.lines && s.lines.covered > 0) {
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
          suggestion: `Implement a test case for contract '${contract.id}' in '${hint}' and run quality gates.`
        });
      }
    }

    return violations;
  }

  private parseContracts(content: string): Array<{ id: string; description: string; test_file_hint: string }> {
    const contracts: any[] = [];
    // Very simple table parser for the contracts table
    // | ID | Description | Test File Hint |
    const lines = content.split("\n");
    let inTable = false;
    for (const line of lines) {
      if (line.includes("| ID |") && line.includes("|")) {
        inTable = true;
        continue;
      }
      if (inTable && line.startsWith("| ---")) continue;
      if (inTable && line.startsWith("|")) {
        const parts = line.split("|").map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          contracts.push({
            id: parts[0],
            description: parts[1],
            test_file_hint: parts[2].replace(/`/g, "")
          });
        }
      } else if (inTable) {
        // Table ended
      }
    }
    return contracts;
  }
}
