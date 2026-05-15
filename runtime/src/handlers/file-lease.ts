import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult } from "./_utils.js";

const LEASE_FILE = ".ritsu/leases.json";

interface Lease {
  path: string;
  span_id: string;
  expires_at: number;
}

function getLeases(root: string): Lease[] {
  const path = resolve(root, LEASE_FILE);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const now = Date.now();
    return data.filter((l: Lease) => l.expires_at > now);
  } catch {
    return [];
  }
}

function saveLeases(root: string, leases: Lease[]) {
  const path = resolve(root, LEASE_FILE);
  writeFileSync(path, JSON.stringify(leases, null, 2));
}

export async function ritsu_claim_file(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filePath = String(params.path);
  const spanId = String(params.span_id);
  const ttl = Number(params.ttl_ms ?? 300000); // 5 min
  
  const leases = getLeases(root);
  const existing = leases.find(l => l.path === filePath);
  
  if (existing && existing.span_id !== spanId) {
    return textResult(JSON.stringify({
      ok: false,
      path: filePath,
      message: `File already claimed by span ${existing.span_id}.`
    }));
  }

  const now = Date.now();
  const newLeases = leases.filter(l => l.path !== filePath);
  newLeases.push({ path: filePath, span_id: spanId, expires_at: now + ttl });
  
  saveLeases(root, newLeases);
  return textResult(JSON.stringify({ ok: true, path: filePath, message: "Lease acquired." }));
}

export async function ritsu_release_file(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filePath = String(params.path);
  const spanId = String(params.span_id);
  
  const leases = getLeases(root);
  const newLeases = leases.filter(l => !(l.path === filePath && l.span_id === spanId));
  
  saveLeases(root, newLeases);
  return textResult(JSON.stringify({ ok: true }));
}

export async function ritsu_list_leases(_params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const leases = getLeases(root);
  return textResult(JSON.stringify({ leases }));
}

export function releaseAllForSpan(root: string, spanId: string) {
  const leases = getLeases(root);
  const newLeases = leases.filter(l => l.span_id !== spanId);
  saveLeases(root, newLeases);
}

export function checkLease(root: string, filePath: string, spanId?: string): { ok: boolean; message?: string } {
  const leases = getLeases(root);
  const existing = leases.find(l => l.path === filePath);
  if (existing && existing.span_id !== spanId) {
    return { ok: false, message: `File is locked by span ${existing.span_id}` };
  }
  return { ok: true };
}
