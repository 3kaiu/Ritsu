/**
 * Contract Registry
 *
 * Structured contract registry, backed by DataStore for atomic persistence.
 * Synchronized from design-sheet markdown automatically.
 *
 * v8.5.0
 */

import { resolve } from "node:path";
import { DataStore } from "./data-store.js";

// ─── Types ────────────────────────────────────────────────────

export type ContractStatus = "pending" | "in_progress" | "verified" | "partial" | "failed" | "deprecated";

export interface ContractEntry {
  id: string;
  description: string;
  test_file_hint: string;
  domain: string;
  status: ContractStatus;
  evidence: string;
  verified_at?: string;
  design_sheet: string;
  created_at: string;
}

export interface ContractRegistry {
  version: number;
  updated_at: string;
  contracts: ContractEntry[];
  design_sheets_index: string[];
}

// ─── Store ────────────────────────────────────────────────────

function getStore(projectRoot: string): DataStore<ContractRegistry> {
  return new DataStore<ContractRegistry>(
    resolve(projectRoot, ".ritsu", "contracts.json"),
    () => ({
      version: 1,
      updated_at: new Date().toISOString(),
      contracts: [],
      design_sheets_index: [],
    }),
  );
}

// ─── Extraction ──────────────────────────────────────────────

export function extractContractsFromDesignSheet(
  content: string,
  designSheetFilename: string,
  domain = "fullstack",
): ContractEntry[] {
  const entries: ContractEntry[] = [];
  const contractRegex = /\|\s*(C\d+|OS-\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
  const now = new Date().toISOString();
  let match: RegExpExecArray | null;

  while ((match = contractRegex.exec(content)) !== null) {
    const id = match[1].trim();
    const description = match[2].trim();
    const fileHint = match[3].trim();
    const combined = `${description} ${fileHint}`.toLowerCase();
    let contractDomain = domain;
    if (/frontend|component|ui\/|react|vue/.test(combined)) contractDomain = "frontend";
    else if (/backend|api|database|route|controller|model/.test(combined)) contractDomain = "backend";

    entries.push({
      id,
      description,
      test_file_hint: fileHint,
      domain: contractDomain,
      status: "pending",
      evidence: "",
      design_sheet: designSheetFilename,
      created_at: now,
    });
  }
  return entries;
}

// ─── Sync ─────────────────────────────────────────────────────

export function syncFromDesignSheet(
  projectRoot: string,
  content: string,
  designSheetFilename: string,
  domain?: string,
): { new_count: number; deprecate_count: number } {
  const store = getStore(projectRoot);
  const extracted = extractContractsFromDesignSheet(content, designSheetFilename, domain);
  const extractedIds = new Set(extracted.map((c) => c.id));
  let newCount = 0;
  let deprecateCount = 0;

  store.update((registry) => {
    for (const entry of registry.contracts) {
      if (entry.design_sheet === designSheetFilename && !extractedIds.has(entry.id)) {
        entry.status = "deprecated";
        deprecateCount++;
      }
    }
    for (const ext of extracted) {
      const existing = registry.contracts.find((c) => c.id === ext.id);
      if (existing) {
        existing.description = ext.description;
        existing.test_file_hint = ext.test_file_hint;
        existing.domain = ext.domain;
        existing.design_sheet = designSheetFilename;
      } else {
        registry.contracts.push(ext);
        newCount++;
      }
    }
    if (!registry.design_sheets_index.includes(designSheetFilename)) {
      registry.design_sheets_index.push(designSheetFilename);
    }
  });

  return { new_count: newCount, deprecate_count: deprecateCount };
}

// ─── Status Updates ──────────────────────────────────────────

export function updateContractStatus(
  projectRoot: string,
  contractId: string,
  status: ContractStatus,
  evidence?: string,
): boolean {
  const store = getStore(projectRoot);
  let found = false;
  store.update((registry) => {
    const contract = registry.contracts.find((c) => c.id === contractId);
    if (!contract) return;
    contract.status = status;
    contract.evidence = evidence ?? contract.evidence;
    if (status === "verified" || status === "failed") contract.verified_at = new Date().toISOString();
    found = true;
  });
  return found;
}

export function getContractsForSheet(projectRoot: string, sheet: string): ContractEntry[] {
  return getStore(projectRoot).read().contracts.filter((c) => c.design_sheet === sheet);
}

export function getActiveContracts(projectRoot: string): ContractEntry[] {
  return getStore(projectRoot).read().contracts.filter((c) => c.status !== "deprecated");
}

export function getContractsByStatus(projectRoot: string): Record<ContractStatus, ContractEntry[]> {
  const registry = getStore(projectRoot).read();
  const grouped: Record<string, ContractEntry[]> = { pending: [], in_progress: [], verified: [], partial: [], failed: [], deprecated: [] };
  for (const c of registry.contracts) grouped[c.status]?.push(c);
  return grouped as Record<ContractStatus, ContractEntry[]>;
}

export function batchUpdateStatus(projectRoot: string, sheet: string, status: ContractStatus): number {
  const store = getStore(projectRoot);
  let count = 0;
  store.update((registry) => {
    for (const contract of registry.contracts) {
      if (contract.design_sheet === sheet) {
        contract.status = status;
        if (status === "verified" || status === "failed") contract.verified_at = new Date().toISOString();
        count++;
      }
    }
  });
  return count;
}
