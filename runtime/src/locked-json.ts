import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { check as checkLock, lock } from "proper-lockfile";

function cloneDefault<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureJsonFile<T>(path: string, fallback: T): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(fallback, null, 2), "utf-8");
  }
}

async function cleanupStaleLock(path: string): Promise<void> {
  const lockPath = `${path}.lock`;
  if (!existsSync(lockPath)) return;

  try {
    const isLocked = await checkLock(path, { lockfilePath: lockPath });
    if (!isLocked) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    rmSync(lockPath, { force: true });
  }
}

function writeJsonAtomically(path: string, value: unknown): void {
  const dir = dirname(path);
  const tmpPath = join(dir, `.tmp-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmpPath, path);
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return cloneDefault(fallback);
  }

  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return cloneDefault(fallback);
    return JSON.parse(raw) as T;
  } catch {
    return cloneDefault(fallback);
  }
}

export async function updateLockedJsonFile<T, R>(
  path: string,
  fallback: T,
  updater: (current: T) => { data: T; result: R } | Promise<{ data: T; result: R }>,
): Promise<R> {
  ensureJsonFile(path, fallback);
  await cleanupStaleLock(path);

  const release = await lock(path, {
    retries: {
      retries: 20,
      factor: 1,
      minTimeout: 25,
      maxTimeout: 25,
    },
  });
  try {
    const current = readJsonFile(path, fallback);
    const { data, result } = await updater(current);
    writeJsonAtomically(path, data);
    return result;
  } finally {
    await release();
  }
}
