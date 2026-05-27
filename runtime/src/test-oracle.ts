/**
 * Semantic Test Oracle
 *
 * Reads Istanbul v8 branch-level coverage data to verify that
 * each contract's target functions are actually EXERCISED by tests,
 * not just textually referenced.
 *
 * Level 3 verification: "does the test execute the contract's code paths?"
 *
 * Input:  Istanbul coverage-final.json (branch + function data)
 *         Contract descriptions (keyword extraction)
 * Output: Per-function coverage status with branch-level evidence
 *
 * v8.8.0
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractKeyPhrases } from "./contract-verification.js";

// ─── Istanbul Types ───────────────────────────────────────────

interface IstanbulLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface IstanbulBranch {
  line: number;
  type: string;
  locations: IstanbulLocation[];
}

interface IstanbulFn {
  name: string;
  line: number;
  decl: IstanbulLocation;
  loc: IstanbulLocation;
}

interface IstanbulFile {
  path: string;
  fnMap: Record<string, IstanbulFn>;
  branchMap: Record<string, IstanbulBranch>;
  f: number[];        // hit counts per function index
  b: number[][];      // hit counts per branch location (array per branch)
}

// ─── Output Types ─────────────────────────────────────────────

export interface FunctionCoverage {
  name: string;
  file: string;
  line: number;
  hit_count: number;
  covered: boolean;
}

export interface BranchCoverage {
  file: string;
  line: number;
  type: string;
  total_locations: number;
  covered_locations: number;
  covered: boolean;
}

export interface ContractVerificationDetail {
  contract_id: string;
  description: string;
  function_coverage: FunctionCoverage[];
  branch_coverage: BranchCoverage[];
  uncovered_functions: string[];
  uncovered_branches: BranchCoverage[];
  overall: "verified" | "partial" | "failed";
  evidence: string;
}

// ─── Istanbul Reader ─────────────────────────────────────────

function readIstanbulData(coveragePath: string): Record<string, IstanbulFile> | null {
  if (!existsSync(coveragePath)) return null;
  try {
    return JSON.parse(readFileSync(coveragePath, "utf-8")) as Record<string, IstanbulFile>;
  } catch {
    return null;
  }
}

// ─── Function Search ─────────────────────────────────────────

/**
 * Search coverage data for functions matching contract keywords.
 *
 * Strategy:
 *   1. Extract key terms from contract description (HTTP methods, API paths, camelCase names)
 *   2. For each function in coverage data, check if name matches any term:
 *      - Exact match (case-insensitive)
 *      - Contains match (function name contains keyword)
 *      - CamelCase match (keyword split on word boundaries)
 *   3. Also scan file paths for matches
 */
function findContractFunctions(
  contractDescription: string,
  coverageData: Record<string, IstanbulFile>,
): Array<{ name: string; file: string; line: number; index: number }> {
  const keywords = extractKeyPhrases(contractDescription);
  const matches: Array<{ name: string; file: string; line: number; index: number }> = [];
  const seen = new Set<string>();

  // Also extract individual words from description
  const words = contractDescription
    .toLowerCase()
    .split(/[\s,;:.!?()\[\]{}"'/\\@#$%^&*+=<>]+/)
    .filter((w) => w.length > 2);

  for (const [filePath, fileData] of Object.entries(coverageData)) {
    for (const [idx, fnMap] of Object.entries(fileData.fnMap)) {
      const fnName = fnMap.name.toLowerCase();
      const fnIndex = parseInt(idx, 10);

      // Check keyword match
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        if (fnName.includes(kwLower) || kwLower.includes(fnName)) {
          const key = `${filePath}:${fnName}`;
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({ name: fnMap.name, file: filePath, line: fnMap.line, index: fnIndex });
          }
          break;
        }
      }

      // Check word match
      if (!seen.has(`${filePath}:${fnName}`)) {
        for (const word of words) {
          if (fnName.includes(word)) {
            const key = `${filePath}:${fnName}`;
            seen.add(key);
            matches.push({ name: fnMap.name, file: filePath, line: fnMap.line, index: fnIndex });
            break;
          }
        }
      }
    }
  }

  return matches;
}

// ─── Coverage Analysis ───────────────────────────────────────

/**
 * Analyze coverage data for a specific contract.
 */
export function analyzeContractCoverage(
  contractId: string,
  contractDescription: string,
  coveragePath: string,
): ContractVerificationDetail {
  const data = readIstanbulData(coveragePath);

  if (!data) {
    return {
      contract_id: contractId,
      description: contractDescription,
      function_coverage: [],
      branch_coverage: [],
      uncovered_functions: [],
      uncovered_branches: [],
      overall: "failed",
      evidence: "No Istanbul coverage data found. Run tests with coverage first.",
    };
  }

  // Find matching functions
  const matchedFunctions = findContractFunctions(contractDescription, data);

  // Build function coverage report
  const functionCoverage: FunctionCoverage[] = [];
  const uncoveredFunctions: string[] = [];

  for (const mf of matchedFunctions) {
    const fileData = data[mf.file];
    if (!fileData) continue;

    const hitCount = fileData.f[mf.index] ?? 0;
    const covered = hitCount > 0;
    functionCoverage.push({
      name: mf.name,
      file: mf.file.split("/").pop() || mf.file,
      line: mf.line,
      hit_count: hitCount,
      covered,
    });
    if (!covered) uncoveredFunctions.push(mf.name);
  }

  // Build branch coverage report for matched files
  const matchedFiles = new Set(matchedFunctions.map((m) => m.file));
  const branchCoverage: BranchCoverage[] = [];
  const uncoveredBranches: BranchCoverage[] = [];

  for (const filePath of matchedFiles) {
    const fileData = data[filePath];
    if (!fileData?.branchMap) continue;

    for (const [idx, branchMap] of Object.entries(fileData.branchMap)) {
      const bi = parseInt(idx, 10);
      const hits = fileData.b[bi] ?? [];
      const totalLocations = branchMap.locations.length;
      const coveredLocations = hits.filter((h: number) => h > 0).length;

      const bc: BranchCoverage = {
        file: filePath.split("/").pop() || filePath,
        line: branchMap.line,
        type: branchMap.type,
        total_locations: totalLocations,
        covered_locations: coveredLocations,
        covered: coveredLocations === totalLocations,
      };

      branchCoverage.push(bc);
      if (!bc.covered) uncoveredBranches.push(bc);
    }
  }

  // Determine overall status
  let overall: "verified" | "partial" | "failed";
  let evidence: string;

  if (functionCoverage.length === 0) {
    overall = "failed";
    evidence = `No matching functions found for contract ${contractId} in coverage data`;
  } else if (uncoveredFunctions.length === 0 && uncoveredBranches.length === 0) {
    overall = "verified";
    evidence = `${functionCoverage.length} functions covered, ${branchCoverage.length} branches all exercised`;
  } else if (uncoveredFunctions.length === functionCoverage.length) {
    overall = "failed";
    evidence = `No functions exercised: ${uncoveredFunctions.join(", ")}`;
  } else {
    overall = "partial";
    const parts: string[] = [];
    if (uncoveredFunctions.length > 0) parts.push(`${uncoveredFunctions.length} functions not exercised`);
    if (uncoveredBranches.length > 0) parts.push(`${uncoveredBranches.length} branches not covered`);
    evidence = parts.join("; ");
  }

  return {
    contract_id: contractId,
    description: contractDescription,
    function_coverage: functionCoverage,
    branch_coverage: branchCoverage,
    uncovered_functions: uncoveredFunctions,
    uncovered_branches: uncoveredBranches,
    overall,
    evidence,
  };
}

/**
 * Run semantic oracle across all active contracts.
 */
export function runSemanticOracle(
  contracts: Array<{ id: string; description: string }>,
  coveragePath: string,
): ContractVerificationDetail[] {
  return contracts.map((c) => analyzeContractCoverage(c.id, c.description, coveragePath));
}
