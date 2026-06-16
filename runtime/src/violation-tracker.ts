/**
 * Violation Tracker
 *
 * Persistent open-violations lifecycle manager.
 * Lifecycle: open → acknowledged → fixed/wont_fix/false_positive
 * Backed by DataStore for atomic persistence.
 *
 * v8.5.0
 */

import { resolve } from "node:path";
import { DataStore } from "./data-store.js";
import { safeExecSync } from "./shared.js";

// ─── Types ────────────────────────────────────────────────────

export type ViolationStatus = "open" | "acknowledged" | "fixed" | "wont_fix" | "false_positive";

export interface TrackedViolation {
  id: string;
  rule_id: string;
  severity: string;
  message: string;
  file: string;
  trace_id: string;
  skill: string;
  status: ViolationStatus;
  evidence: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  commit_sha?: string;
}

export interface ViolationStore {
  version: number;
  updated_at: string;
  violations: TrackedViolation[];
}

export interface ViolationQuery {
  status?: ViolationStatus | ViolationStatus[];
  rule_id?: string;
  file?: string;
  skill?: string;
  limit?: number;
}

// ─── Store ────────────────────────────────────────────────────

function getStore(projectRoot: string): DataStore<ViolationStore> {
  return new DataStore<ViolationStore>(
    resolve(projectRoot, ".ritsu", "violations.json"),
    () => ({
      version: 1,
      updated_at: new Date().toISOString(),
      violations: [],
    }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────

let seqCounter = 0;

function generateId(): string {
  seqCounter++;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `v-${ts}-${String(seqCounter).padStart(3, "0")}`;
}

function extractFile(evidence: string): string {
  const match = evidence.match(/^([^:\s][^:]*?)(?::\d+| —|\s|$)/);
  if (match) {
    const file = match[1].trim();
    if (!file.includes(" ") && !file.startsWith("(") && file.length > 1) return file;
  }
  return "";
}

function truncateMessage(msg: string, max = 60): string {
  return msg.length > max ? msg.slice(0, max) : msg;
}

function getCurrentCommit(root: string): string {
  try {
    return safeExecSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
  } catch {
    return "";
  }
}

// ─── Core ────────────────────────────────────────────────────

export function captureViolation(
  projectRoot: string,
  params: {
    rule_id: string;
    severity: string;
    message: string;
    evidence?: string;
    trace_id?: string;
    skill?: string;
    file?: string;
  },
): TrackedViolation {
  const store = getStore(projectRoot);
  const file = params.file || extractFile(params.evidence || "") || "unknown";
  const messageKey = truncateMessage(params.message);

  let captured: TrackedViolation | null = null;

  store.update((data) => {
    // Dedup: same (rule_id, file, ~message) that's still open
    const existing = data.violations.find(
      (v) => v.status === "open" && v.rule_id === params.rule_id && v.file === file && truncateMessage(v.message) === messageKey,
    );
    if (existing) {
      existing.updated_at = new Date().toISOString();
      if (params.trace_id) existing.trace_id = params.trace_id;
      if (params.evidence) existing.evidence = params.evidence;
      captured = existing;
      return;
    }

    const violation: TrackedViolation = {
      id: generateId(),
      rule_id: params.rule_id,
      severity: params.severity,
      message: params.message,
      file,
      trace_id: params.trace_id || "",
      skill: params.skill || "",
      status: "open",
      evidence: params.evidence || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      commit_sha: getCurrentCommit(projectRoot),
    };
    data.violations.push(violation);
    captured = violation;
  });

  return captured!;
}

export function resolveViolation(projectRoot: string, violationId: string, status: ViolationStatus): boolean {
  const store = getStore(projectRoot);
  let found = false;
  store.update((data) => {
    const v = data.violations.find((v) => v.id === violationId);
    if (!v) return;
    v.status = status;
    v.updated_at = new Date().toISOString();
    if (status === "fixed" || status === "wont_fix" || status === "false_positive") {
      v.resolved_at = new Date().toISOString();
    }
    found = true;
  });
  return found;
}

export function resolveViolationsByRule(projectRoot: string, ruleId: string, file?: string): number {
  const store = getStore(projectRoot);
  let count = 0;
  store.update((data) => {
    for (const v of data.violations) {
      if (v.status !== "open") continue;
      if (v.rule_id !== ruleId) continue;
      if (file && v.file !== file) continue;
      v.status = "fixed";
      v.updated_at = new Date().toISOString();
      v.resolved_at = new Date().toISOString();
      count++;
    }
  });
  return count;
}

export function resolveViolationsByFile(projectRoot: string, file: string): number {
  const store = getStore(projectRoot);
  let count = 0;
  store.update((data) => {
    for (const v of data.violations) {
      if (v.status !== "open") continue;
      if (v.file !== file) continue;
      v.status = "fixed";
      v.updated_at = new Date().toISOString();
      v.resolved_at = new Date().toISOString();
      count++;
    }
  });
  return count;
}

// ─── Queries ─────────────────────────────────────────────────

export function readStore(projectRoot: string): ViolationStore {
  return getStore(projectRoot).read();
}

export function queryViolations(projectRoot: string, query?: ViolationQuery): TrackedViolation[] {
  let results = getStore(projectRoot).read().violations;
  if (query) {
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      results = results.filter((v) => statuses.includes(v.status));
    }
    if (query.rule_id) results = results.filter((v) => v.rule_id === query.rule_id);
    if (query.file) results = results.filter((v) => v.file.includes(query.file!));
    if (query.skill) results = results.filter((v) => v.skill === query.skill);
  }
  results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (query?.limit && query.limit > 0) results = results.slice(0, query.limit);
  return results;
}

export function getOpenViolations(projectRoot: string): TrackedViolation[] {
  return queryViolations(projectRoot, { status: ["open", "acknowledged"] });
}

export function getViolationsByFile(projectRoot: string): Record<string, TrackedViolation[]> {
  const open = getOpenViolations(projectRoot);
  const byFile: Record<string, TrackedViolation[]> = {};
  for (const v of open) {
    if (!byFile[v.file]) byFile[v.file] = [];
    byFile[v.file].push(v);
  }
  const sorted = Object.entries(byFile).sort(([, a], [, b]) => b.length - a.length);
  return Object.fromEntries(sorted);
}

export function getViolationTrend(projectRoot: string): { period: string; opened: number; resolved: number; net: number }[] {
  const all = getStore(projectRoot).read().violations;
  const byMonth = new Map<string, { opened: number; resolved: number }>();
  for (const v of all) {
    const m = v.created_at.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, { opened: 0, resolved: 0 });
    byMonth.get(m)!.opened++;
    if (v.resolved_at) {
      const rm = v.resolved_at.slice(0, 7);
      if (!byMonth.has(rm)) byMonth.set(rm, { opened: 0, resolved: 0 });
      byMonth.get(rm)!.resolved++;
    }
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, c]) => ({ period, opened: c.opened, resolved: c.resolved, net: c.opened - c.resolved }));
}
