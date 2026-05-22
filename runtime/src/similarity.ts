/**
 * 统一相似度计算
 *
 * 消除 Jaccard 在三处的重复实现 (native-bridge, miner, similar-violations)。
 * 单一事实来源，提供 Jaccard、余弦、并支持中日韩字符 (CJK) 分词。
 */

export function tokenize(text: string, minLen = 3): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_一-鿿぀-ゟ゠-ヿ]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= minLen);
}

export function jaccardSimilarity(a: string, b: string, minTokenLen = 3): number {
  const setA = new Set(tokenize(a, minTokenLen));
  const setB = new Set(tokenize(b, minTokenLen));
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
