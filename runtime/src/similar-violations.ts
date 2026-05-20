import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ViolationRecord = {
  ts: string;
  rule_id: string;
  evidence: string;
  skill?: string;
};

export type SimilarViolationHit = {
  rule_id: string;
  evidence: string;
  ts: string;
  score: number;
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\u4e00-\u9fff]+/gi, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function loadViolationRecords(
  ritsuDir: string,
  sinceYyyymmdd: string,
): ViolationRecord[] {
  if (!existsSync(ritsuDir)) return [];

  const records: ViolationRecord[] = [];
  const files = readdirSync(ritsuDir).filter(
    (f) => f.startsWith("ctx-") && f.endsWith(".jsonl"),
  );

  for (const file of files) {
    const content = readFileSync(resolve(ritsuDir, file), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e.status !== "violation_detected") continue;
        const ts = typeof e.ts === "string" ? e.ts : "";
        const cleanTs = ts.replace(/-/g, "");
        const tsYmd = cleanTs.slice(0, 8);
        if (tsYmd && tsYmd < sinceYyyymmdd) continue;
        const v =
          typeof e.violation === "object" && e.violation !== null
            ? (e.violation as Record<string, unknown>)
            : e;
        const ruleId =
          typeof v.rule_id === "string" ? v.rule_id : "unknown";
        const evidence =
          typeof v.evidence === "string"
            ? v.evidence
            : typeof e.error === "string"
              ? e.error
              : "";
        records.push({
          ts,
          rule_id: ruleId,
          evidence,
          skill: typeof e.skill === "string" ? e.skill : undefined,
        });
      } catch {
        // skip bad lines
      }
    }
  }
  return records;
}

export function findSimilarViolations(
  records: ViolationRecord[],
  query: string,
  limit = 10,
  minScore = 0.15,
): SimilarViolationHit[] {
  const hits: SimilarViolationHit[] = [];
  for (const r of records) {
    const haystack = `${r.rule_id} ${r.evidence}`;
    const score = jaccardSimilarity(query, haystack);
    if (score >= minScore) {
      hits.push({
        rule_id: r.rule_id,
        evidence: r.evidence,
        ts: r.ts,
        score,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
