import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";

const KEY_FILE = ".ritsu/secret.key";

interface SignableEvent {
  ts?: unknown;
  trace_id?: unknown;
  span_id?: unknown;
  status?: unknown;
  artifact?: unknown;
  violation?: unknown;
}

interface VerifiableEvent extends SignableEvent {
  signature?: unknown;
}

export function getOrCreateKey(): string | null {
  const root = getProjectRoot();
  const path = resolve(root, KEY_FILE);
  
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  return null;
}

export function initKey(): string {
  const root = getProjectRoot();
  const path = resolve(root, KEY_FILE);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const key = createHmac("sha256", "ritsu-seed-" + Math.random())
    .update(Date.now().toString())
    .digest("hex");
    
  writeFileSync(path, key, "utf-8");
  return key;
}

export function signEvent(event: SignableEvent, key: string): string {
  const payload = JSON.stringify({
    ts: event.ts,
    trace_id: event.trace_id,
    span_id: event.span_id,
    status: event.status,
    artifact: event.artifact,
    violation: event.violation,
  });
  
  return createHmac("sha256", key).update(payload).digest("hex");
}

export function verifyEvent(event: VerifiableEvent, key: string): boolean {
  if (typeof event.signature !== "string" || !event.signature) return false;
  
  const expected = signEvent(event, key);
  const actual = Buffer.from(event.signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  
  if (actual.length !== expectedBuf.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}
