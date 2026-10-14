import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/** 仅模拟服务事务与SQL参数合同；不是PostgreSQL集成验收。 */
export function reportMemoryDb() {
  let data: Record<string, any[]> = {};
  let serial = Promise.resolve();
  const dialect = new PgDialect();
  const tables = new Map<string, any>();
  const db: any = {
    rows(table: any) { const name = getTableName(table); tables.set(name, table); return data[name] ??= []; },
    select(projection?: any) {
      let table: any, predicate: any, joined: any, maximum = Infinity;
      const builder: any = {
        from(t: any) { table = t; db.rows(t); return builder; },
        innerJoin(t: any) { joined = t; db.rows(t); return builder; },
        leftJoin(t: any) { joined = t; db.rows(t); return builder; },
        where(p: any) { predicate = p; return builder; }, for() { return builder; },
        orderBy() { return builder; }, limit(n: number) { maximum = n; return builder; },
        then(resolve: any, reject: any) {
          let rows = db.rows(table).filter((row: any) => matches(table, row, predicate, joined)).slice(-maximum).reverse();
          if (projection) rows = rows.map((row: any) => Object.fromEntries(Object.entries(projection).map(([key, target]: any) => {
            if (target === table) return [key, row];
            if (target === joined) return [key, db.rows(joined).find((item: any) => item.id === row.fileId || item.id === row.projectId) ?? null];
            return [key, row[key]];
          })));
          return Promise.resolve(structuredClone(rows)).then(resolve, reject);
        }
      };
      return builder;
    },
    insert(table: any) { return { values(values: any) {
      let conflict: any;
      const run = () => {
        let row = conflict && db.rows(table).find((r: any) => conflict.target.every((column: any) => {
          const key = Object.keys(getTableColumns(table)).find(k => (getTableColumns(table) as any)[k] === column)!;
          return r[key] === values[key];
        }));
        if (row) Object.assign(row, conflict.set);
        else { row = { id: randomUUID(), status: "QUEUED", createdAt: new Date(), ...structuredClone(values) }; db.rows(table).push(row); }
        return [structuredClone(row)];
      };
      const result: any = { onConflictDoUpdate(c: any) { conflict = c; return result; }, returning: async () => run(), then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject) };
      return result;
    } }; },
    update(table: any) { return { set(values: any) { return { where(predicate: any) {
      const run = () => { const rows = db.rows(table).filter((r: any) => matches(table, r, predicate)); rows.forEach((r: any) => Object.assign(r, structuredClone(values))); return structuredClone(rows); };
      return { returning: async () => run(), then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
        catch: (reject: any) => Promise.resolve().then(run).catch(reject) };
    } }; } }; },
    transaction(run: any) {
      const operation = serial.then(async () => { const before = structuredClone(data); try { return await run(db); } catch (error) { data = before; throw error; } });
      serial = operation.catch(() => {}); return operation;
    }
  };
  function matches(table: any, row: any, predicate: any, joined?: any) {
    if (!predicate) return true;
    const { sql, params } = dialect.sqlToQuery(predicate);
    const read = (name: string, column: string) => {
      const t = tables.get(name); if (!t) return undefined;
      const columns: any = getTableColumns(t); const key = Object.keys(columns).find(k => columns[k].name === column)!;
      if (t === table) return row[key];
      return db.rows(t).find((r: any) => r.reportId === row.id || r.id === row.fileId || r.id === row.projectId)?.[key];
    };
    if (![...sql.matchAll(/"([^"]+)"\."([^"]+)" (=|<>) \$(\d+)/g)].every(m => m[3] === "=" ? read(m[1]!, m[2]!) === params[Number(m[4]) - 1] : read(m[1]!, m[2]!) !== params[Number(m[4]) - 1])) return false;
    if (![...sql.matchAll(/"([^"]+)"\."([^"]+)" is null/g)].every(m => read(m[1]!, m[2]!) == null)) return false;
    const snapshot = /->>'solutionSnapshotId' = \$(\d+)/.exec(sql);
    if (snapshot && (!joined || !db.rows(joined).some((r: any) => r.reportId === row.id && r.dataJson.solutionSnapshotId === params[Number(snapshot[1]) - 1]))) return false;
    return true;
  }
  return db;
}
