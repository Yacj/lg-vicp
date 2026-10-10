/**
 * 知识库单测共享「内存 drizzle 桩」。
 *
 * 目的：让内存桩真正「按 where 条件过滤 / 按 select 投影 / 支持原子自增表达式」，
 * 使 purge / integrity / rebuild CAS / contentRevision 的断言有效，
 * 而不是「delete 清空整表、select 返回全表」的假通过。
 *
 * 覆盖算子：eq / and / or / inArray / 原始 sql（JSON ->> 提取、<> 字面量比较、col + 1 自增）/ count()。
 */
import {
  auditLogs,
  knowledgeAliases,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePageBlocks,
  knowledgePages,
  knowledgeSections,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";

export function isColumn(value: unknown): boolean {
  return value != null && typeof value === "object"
    && typeof (value as { name?: unknown }).name === "string"
    && (value as { table?: unknown }).table != null;
}
export function isSQL(value: unknown): boolean {
  return value != null && (value as { constructor?: { name?: string } }).constructor?.name === "SQL"
    && Array.isArray((value as { queryChunks?: unknown }).queryChunks);
}
function isStringChunk(value: unknown): boolean {
  return value != null && (value as { constructor?: { name?: string } }).constructor?.name === "StringChunk";
}
function isParam(value: unknown): boolean {
  return value != null && (value as { constructor?: { name?: string } }).constructor?.name === "Param";
}

/** 列对象 → 内存行的 JS 属性名（drizzle 的 column.name 是 DB 名如 version_id，行对象用 camelCase 键）。 */
export function columnKey(column: unknown): string {
  const table = (column as { table?: Record<string, unknown> })?.table;
  if (table) {
    for (const key of Object.keys(table)) {
      if (table[key] === column) return key;
    }
  }
  return (column as { name?: string })?.name ?? "unknown";
}

/** 拼接 SQL 中的静态文本片段（StringChunk），用于识别运算符与 JSON 提取路径。 */
export function sqlText(sql: unknown): string {
  const chunks = (sql as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map((chunk) => (isStringChunk(chunk) ? (chunk as { value: string[] }).value.join("") : "")).join("");
}

/** 收集插值参数（Param 对象或原始字符串/数字字面量），数组参数会被展平。 */
export function collectValues(chunks: unknown[], out: unknown[]): void {
  for (const chunk of chunks) {
    if (Array.isArray(chunk)) collectValues(chunk, out);
    else if (isParam(chunk)) {
      const value = (chunk as { value: unknown }).value;
      if (Array.isArray(value)) out.push(...value);
      else out.push(value);
    } else if (typeof chunk === "string" || typeof chunk === "number") out.push(chunk);
  }
}

/** 求值 select 投影中的单个表达式（列 / 参数 / JSON ->> 提取）。 */
export function evalExpression(expr: unknown, row: Record<string, unknown>): unknown {
  if (isColumn(expr)) return row[columnKey(expr)];
  if (isParam(expr)) return (expr as { value: unknown }).value;
  if (typeof expr === "string" || typeof expr === "number") return expr;
  if (isSQL(expr)) {
    const text = sqlText(expr);
    const columns = ((expr as { queryChunks?: unknown[] }).queryChunks ?? []).filter(isColumn);
    const jsonKey = /->>\s*'([^']+)'/.exec(text)?.[1];
    if (jsonKey && columns.length > 0) {
      const base = row[columnKey(columns[0])] as Record<string, unknown> | undefined;
      return base == null ? null : base[jsonKey];
    }
    if (columns.length === 1) return row[columnKey(columns[0])];
    return undefined;
  }
  return undefined;
}

/**
 * 求值 update().set() 中的单个补丁值：支持「列 + 数字」的原子自增表达式
 * （markPageContentMutation 使用 contentRevision = contentRevision + 1）。
 */
export function evalPatchValue(patch: unknown, row: Record<string, unknown>): unknown {
  if (!isSQL(patch)) return patch;
  const text = sqlText(patch);
  const columns = ((patch as { queryChunks?: unknown[] }).queryChunks ?? []).filter(isColumn);
  const increment = /(\+\s*)(\d+)/.exec(text);
  if (columns.length === 1 && increment) {
    const base = Number(row[columnKey(columns[0])] ?? 0);
    return base + Number(increment[2]);
  }
  if (columns.length === 1 && text.includes("-")) {
    const decrement = /(-\s*)(\d+)/.exec(text);
    if (decrement) return Number(row[columnKey(columns[0])] ?? 0) - Number(decrement[2]);
  }
  return evalExpression(patch, row);
}

/** 求值 where 条件：复合（and/or）递归，叶子按列 + 运算符 + 值比较。 */
export function evalCondition(condition: unknown, row: Record<string, unknown>): boolean {
  if (condition == null || !isSQL(condition)) return true;
  const chunks: unknown[] = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
  const nested = chunks.filter(isSQL);
  if (nested.length > 0) {
    const operands: boolean[] = [];
    const connectors: string[] = [];
    for (const chunk of chunks) {
      if (isSQL(chunk)) operands.push(evalCondition(chunk, row));
      else if (isStringChunk(chunk)) {
        const token = (chunk as { value: string[] }).value.join("").trim();
        if (token === "and") connectors.push("and");
        else if (token === "or") connectors.push("or");
      }
    }
    if (operands.length === 0) return true;
    if (connectors.includes("or")) return operands.some(Boolean);
    return operands.every(Boolean);
  }
  const columns = chunks.filter(isColumn);
  if (columns.length === 0) return true;
  const columnName = columnKey(columns[0]);
  const operatorText = sqlText(condition);
  const jsonKey = /->>\s*'([^']+)'/.exec(operatorText)?.[1];
  const values: unknown[] = [];
  collectValues(chunks, values);
  const rowValue = jsonKey ? (row[columnName] as Record<string, unknown> | undefined)?.[jsonKey] : row[columnName];
  // SQL 字面量（如 `... = 'REVIEW_REQUIRED'`）位于 StringChunk 中而非 Param，需从文本回退提取。
  // 只取比较运算符之后的字面量，避免把 JSON 路径 `->>'recognitionStatus'` 误当成值。
  const compareLiterals = [...operatorText.matchAll(/\s(?:<>|!=|>=|<=|=)\s*'([^']*)'/g)].map((match) => match[1]);
  if (/\sin\s/.test(operatorText)) {
    const inPart = operatorText.slice(operatorText.search(/\sin\s/));
    const inLiterals = [...inPart.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    const candidates = values.length > 0 ? values : inLiterals;
    return candidates.includes(rowValue);
  }
  if (operatorText.includes("<>") || operatorText.includes("!=")) {
    const expected = values.length > 0 ? values[0] : compareLiterals[0];
    return rowValue !== expected;
  }
  if (operatorText.includes("=")) {
    const expected = values.length > 0 ? values[0] : compareLiterals[0];
    return rowValue === expected;
  }
  return true;
}

export type MemoryStore = Record<string, Record<string, unknown>[]>;

/** 内存版 drizzle 桩：按表对象分派，支持 select/insert/update/delete/transaction，并按条件过滤。 */
export function createMemoryDb(store: MemoryStore) {
  const tableKey = new Map<unknown, string>([
    [auditLogs, "auditLogs"],
    [knowledgeDocuments, "knowledgeDocuments"],
    [knowledgeDocumentVersions, "knowledgeDocumentVersions"],
    [knowledgePages, "knowledgePages"],
    [knowledgeSections, "knowledgeSections"],
    [knowledgePageBlocks, "knowledgePageBlocks"],
    [knowledgeChunks, "knowledgeChunks"],
    [knowledgeAliases, "knowledgeAliases"],
    [thermalReferenceRows, "thermalReferenceRows"],
    [thermalReferenceSets, "thermalReferenceSets"]
  ]);
  const nameOf = (table: unknown): string => tableKey.get(table) ?? "unknown";
  const rowsOf = (table: unknown) => store[nameOf(table)] ?? (store[nameOf(table)] = []);

  const applySelect = (table: unknown, projection: unknown, condition: unknown) => {
    const rows = rowsOf(table).filter((row) => evalCondition(condition, row));
    if (!projection || typeof projection !== "object" || Object.keys(projection).length === 0) {
      return rows.map((row) => ({ ...row }));
    }
    const keys = Object.keys(projection);
    const countKey = keys.find((key) => isSQL((projection as Record<string, unknown>)[key])
      && /count\s*\(/i.test(sqlText((projection as Record<string, unknown>)[key])));
    if (countKey) return [{ [countKey]: rows.length }];
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) out[key] = evalExpression((projection as Record<string, unknown>)[key], row);
      return out;
    });
  };

  const selectChain = (table: unknown, projection?: unknown) => {
    let condition: unknown = null;
    const q: Record<string, unknown> = {
      where: (cond: unknown) => { condition = cond; return q; },
      orderBy: () => q,
      limit: async () => applySelect(table, projection, condition),
      returning: async () => applySelect(table, projection, condition),
      innerJoin: () => q,
      leftJoin: () => q,
      then: (resolve: (value: unknown[]) => unknown) => resolve(applySelect(table, projection, condition))
    };
    return q;
  };

  const db: Record<string, unknown> = {
    select: (projection?: unknown) => ({ from: (table: unknown) => selectChain(table, projection) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const list = Array.isArray(values) ? values : [values];
        const inserted = list.map((value) => ({ ...(value as object) }));
        rowsOf(table).push(...inserted);
        return {
          returning: async () => inserted,
          then: (resolve: (value: unknown[]) => unknown) => resolve(inserted)
        };
      }
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          for (const row of rowsOf(table)) {
            if (evalCondition(condition, row)) {
              for (const [key, value] of Object.entries(patch)) {
                row[key] = evalPatchValue(value, row);
              }
            }
          }
          return {
            returning: async () => applySelect(table, undefined, condition),
            then: (resolve: (value: unknown[]) => unknown) => resolve(applySelect(table, undefined, condition))
          };
        }
      })
    }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        const rows = rowsOf(table);
        const removed = rows.filter((row) => evalCondition(condition, row));
        const kept = rows.filter((row) => !evalCondition(condition, row));
        store[nameOf(table)] = kept;
        return {
          returning: async () => removed.map((row) => ({ ...row })),
          then: (resolve: (value: unknown[]) => unknown) => resolve(removed.map((row) => ({ ...row })))
        };
      }
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // 行级快照，用于模拟事务回滚（rebuild CAS 冲突必须丢弃本次重建结果）。
      const snapshot: MemoryStore = {};
      for (const [key, rows] of Object.entries(store)) snapshot[key] = rows.map((row) => ({ ...row }));
      try {
        return await fn(db);
      } catch (error) {
        for (const key of Object.keys(store)) delete store[key];
        Object.assign(store, snapshot);
        throw error;
      }
    },
    /**
     * 原生 SQL 不参与内存求值（仅用于 `SELECT ... FOR UPDATE` 行锁与已由 ORM 覆盖的清理语句）。
     * 需要断言原生 SQL 效果时，请改用 ORM 路径或真实数据库集成测试。
     */
    execute: async () => []
  };
  return { db, store };
}

/**
 * 让某张表的查询在返回结果前触发 hook（用于确定性模拟「rebuild 期间发生 Page Mutation」）。
 * 仅替换该表的 select 链，返回空结果集（等价于测试中该表无数据）。
 */
export function hookSelectTable(
  db: Record<string, unknown>,
  table: unknown,
  hook: () => void | Promise<void>
): void {
  const originalSelect = db.select as (projection?: unknown) => { from: (t: unknown) => unknown };
  db.select = (projection?: unknown) => {
    const outer = originalSelect(projection);
    return {
      from: (t: unknown) => {
        if (t !== table) return outer.from(t);
        return {
          where: () => ({
            then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
              Promise.resolve(hook()).then(() => [] as unknown[]).then(resolve, reject)
          })
        };
      }
    };
  };
}
