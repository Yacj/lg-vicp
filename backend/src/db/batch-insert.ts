/**
 * 批量写入的参数上限约束。
 * PostgreSQL 前后端协议用 int16 表示绑定参数个数，单条语句最多 65535 个参数；
 * 超出会直接报错，而不是降级执行。所有由文档规模决定行数的插入都必须分批。
 */

export const PG_MAX_BIND_PARAMS = 65535;

/** 按列数推算单批行数：受协议参数上限约束，同时可由调用方用 maxRows 进一步压低内存峰值 */
export function insertBatchSize(
  columnCount: number,
  maxRows = Number.POSITIVE_INFINITY,
  maxParams = PG_MAX_BIND_PARAMS
): number {
  if (!Number.isInteger(columnCount) || columnCount <= 0) {
    throw new Error("批量写入的列数必须为正整数");
  }
  return Math.max(1, Math.min(Math.floor(maxParams / columnCount), Math.floor(maxRows)));
}

/**
 * 惰性切分待插入行。列数按首行键数推断——同一次插入的行由同一个映射产生，键集合固定。
 */
export function* toInsertBatches<T extends object>(
  rows: readonly T[],
  maxRows?: number,
  maxParams = PG_MAX_BIND_PARAMS
): Generator<T[]> {
  const first = rows[0];
  if (!first) return;
  const size = insertBatchSize(Object.keys(first).length, maxRows, maxParams);
  for (let start = 0; start < rows.length; start += size) {
    yield rows.slice(start, start + size);
  }
}