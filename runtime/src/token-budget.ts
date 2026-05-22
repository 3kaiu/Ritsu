/**
 * Universal Token Squeezer
 *
 * 两个纯函数工具，用于估算 JSON 对象的 Token 数，
 * 并在超出预算时按优先级丢弃低价值字段。
 *
 * 插入点在 preflight 和 read_ctx 的响应出口，
 * 确保动态上下文始终控制在缓存窗口内。
 */

/** 粗略估算 Token 数: 4 chars ≈ 1 token，JSON 结构开销追加 10% */
export function estimateTokens(obj: unknown): number {
  const raw = JSON.stringify(obj);
  // chars → tokens, 加 JSON 结构（括号/冒号/逗号）开销
  return Math.ceil(raw.length / 3.5);
}

/**
 * 按优先级保留字段，超出 budget 时从低优先级开始丢弃。
 * priority 数组第一项为最高优先级(永不丢弃)，最后一项为最先丢弃。
 * 返回裁剪后的新对象；未超出 budget 则原样返回。
 */
export function trimToBudget<T extends Record<string, unknown>>(
  obj: T,
  budget: number,
  priority: string[],
): T {
  // Fast path: 不超过预算，直接返回
  if (estimateTokens(obj) <= budget) return obj;

  // 建立优先级映射: field → rank (0 = 最高, n = 最低)
  const rank = new Map<string, number>();
  for (let i = 0; i < priority.length; i++) {
    rank.set(priority[i], i);
  }

  // 按优先级从低到高逐字段尝试删除
  const result = { ...obj };
  for (let r = priority.length - 1; r >= 1; r--) {
    // 找出当前 rank 的所有字段
    const fieldsAtRank: string[] = [];
    for (const [key, rk] of rank) {
      if (rk === r && key in result) {
        fieldsAtRank.push(key);
      }
    }
    // 删除这个 rank 的所有字段
    for (const key of fieldsAtRank) {
      delete result[key];
    }
    // 重新检查预算
    if (estimateTokens(result) <= budget) break;
  }

  return result;
}
