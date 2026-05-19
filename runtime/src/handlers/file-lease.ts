import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { getProjectRoot, textResult } from "./_utils.js";
import { readJsonFile, updateLockedJsonFile } from "../locked-json.js";

const LEASE_FILE = ".ritsu/leases.json";

interface Lease {
  path: string;
  span_id: string;
  expires_at: number;
}

function getLeases(root: string): Lease[] {
  const path = resolve(root, LEASE_FILE);
  const data = readJsonFile<Lease[]>(path, []);
  const now = Date.now();
  return data.filter((lease) => lease.expires_at > now);
}

export async function ritsu_claim_file(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filePath = String(params.path);
  const spanId = String(params.span_id);
  const ttl = Number(params.ttl_ms ?? 300000); // 5 min

  const leasePath = resolve(root, LEASE_FILE);
  const result = await updateLockedJsonFile<Lease[], Record<string, unknown>>(
    leasePath,
    [],
    (current) => {
      const now = Date.now();
      const activeLeases = current.filter((lease) => lease.expires_at > now);
      const existing = activeLeases.find((lease) => lease.path === filePath);

      if (existing && existing.span_id !== spanId) {
        return {
          data: activeLeases,
          result: {
            ok: false,
            path: filePath,
            message: `File already claimed by span ${existing.span_id}.`,
          },
        };
      }

      const nextLeases = activeLeases.filter((lease) => lease.path !== filePath);
      nextLeases.push({
        path: filePath,
        span_id: spanId,
        expires_at: now + ttl,
      });

      return {
        data: nextLeases,
        result: {
          ok: true,
          path: filePath,
          message: "Lease acquired.",
        },
      };
    },
  );

  return textResult(JSON.stringify(result));
}

export async function ritsu_release_file(params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const filePath = String(params.path);
  const spanId = String(params.span_id);

  await updateLockedJsonFile<Lease[], null>(
    resolve(root, LEASE_FILE),
    [],
    (current) => ({
      data: current.filter(
        (lease) =>
          lease.expires_at > Date.now() &&
          !(lease.path === filePath && lease.span_id === spanId),
      ),
      result: null,
    }),
  );

  return textResult(JSON.stringify({ ok: true }));
}

export async function ritsu_list_leases(_params: Record<string, unknown>): Promise<CallToolResult> {
  const root = getProjectRoot();
  const leases = getLeases(root);
  return textResult(JSON.stringify({ leases }));
}

export async function releaseAllForSpan(root: string, spanId: string): Promise<void> {
  await updateLockedJsonFile<Lease[], null>(
    resolve(root, LEASE_FILE),
    [],
    (current) => ({
      data: current.filter(
        (lease) =>
          lease.expires_at > Date.now() && lease.span_id !== spanId,
      ),
      result: null,
    }),
  );
}

export function checkLease(root: string, filePath: string, spanId?: string): { ok: boolean; message?: string } {
  const leases = getLeases(root);
  const existing = leases.find(l => l.path === filePath);
  if (existing && existing.span_id !== spanId) {
    return { ok: false, message: `File is locked by span ${existing.span_id}` };
  }
  return { ok: true };
}
