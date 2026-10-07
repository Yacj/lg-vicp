import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/** 用 PostgreSQL 实例中的隔离临时库验证新环境、漏迁移升级、已手工执行及冲突回滚。 */
export async function verifyWithPostgres(url, directory, integration) {
  const admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const migrations = readMigrationFiles({ migrationsFolder: directory });
  const journal = JSON.parse(readFileSync(path.join(directory, "meta/_journal.json"), "utf8"));
  const created = [];
  const clients = [];
  const create = async (suffix) => {
    const name = `vicp_verify_${Date.now()}_${suffix}`;
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created.push(name);
    const dbUrl = new URL(url);
    dbUrl.pathname = `/${name}`;
    const client = postgres(dbUrl.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
    clients.push(client);
    return client;
  };
  // 构造各种历史水位，每个历史 migration 独立提交；升级使用真实 Drizzle migrate。
  const applyChain = async (client, skip0032) => {
    await client.unsafe('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);');
    for (const [index, entry] of journal.entries.entries()) {
      if (entry.idx === 51 || skip0032 && entry.idx === 32) continue;
      const migration = migrations[index];
      await client.begin(async (tx) => {
        for (const statement of migration.sql) if (statement.trim()) await tx.unsafe(statement);
        await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
      });
    }
  };
  const assertIndexes = async (client) => {
    const indexes = await client`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('users', 'user_identities')`;
    assert(indexes.some((row) => row.indexname === "user_identities_identifier_unique"));
    assert(!indexes.some((row) => row.indexname === "user_identities_type_identifier_unique"));
    assert(indexes.find((row) => row.indexname === "users_phone_unique").indexdef.includes("btrim"));
    assert(indexes.find((row) => row.indexname === "users_email_unique").indexdef.includes("lower"));
  };
  try {
    const pristine = await create("drizzle_fresh");
    await migrate(drizzle(pristine), { migrationsFolder: directory });
    await assertIndexes(pristine);
    console.log("[预检] 空库真实 Drizzle migrate 全量链通过");
    const clean = await create("clean");
    await applyChain(clean, false);
    const originalIndexes = await clean`SELECT indexrelid::text FROM pg_index WHERE indrelid IN ('users'::regclass, 'user_identities'::regclass) ORDER BY indexrelid`;
    await migrate(drizzle(clean), { migrationsFolder: directory });
    assert.deepEqual(await clean`SELECT indexrelid::text FROM pg_index WHERE indrelid IN ('users'::regclass, 'user_identities'::regclass) ORDER BY indexrelid`, originalIndexes, "正确索引必须跳过，不重复重建");
    await assertIndexes(clean);
    assert.equal(Number((await clean`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`)[0].n), migrations.length);
    await migrate(drizzle(clean), { migrationsFolder: directory });
    console.log("[预检] 新库全量链与 Drizzle 重复迁移通过");

    const skipped = await create("skipped");
    await applyChain(skipped, true);
    await migrate(drizzle(skipped), { migrationsFolder: directory });
    await assertIndexes(skipped);
    console.log("[预检] 已到 0050 但缺 0032 的数据库前向升级通过");

    const manual = await create("manual");
    await applyChain(manual, true);
    for (const statement of migrations[journal.entries.findIndex((entry) => entry.idx === 32)].sql) if (statement.trim()) await manual.unsafe(statement);
    await migrate(drizzle(manual), { migrationsFolder: directory });
    await assertIndexes(manual);
    console.log("[预检] 手工已执行 0032 的数据库升级通过");

    const dirty = await create("conflict");
    await applyChain(dirty, true);
    const users = await dirty`INSERT INTO users (display_name, role) VALUES ('迁移验收1','NORMAL_USER'), ('迁移验收2','NORMAL_USER') RETURNING id`;
    await dirty`INSERT INTO user_identities (user_id, type, identifier) VALUES (${users[0].id},'PHONE','same-login'), (${users[1].id},'USERNAME','same-login')`;
    await assert.rejects(migrate(drizzle(dirty), { migrationsFolder: directory }));
    assert.equal(Number((await dirty`SELECT count(*) AS n FROM drizzle.__drizzle_migrations WHERE created_at=${migrations.at(-1).folderMillis}`)[0].n), 0);
    assert.equal(Number((await dirty`SELECT count(*) AS n FROM user_identities`)[0].n), 2);
    assert.equal(Number((await dirty`SELECT count(*) AS n FROM pg_indexes WHERE indexname='user_identities_type_identifier_unique'`)[0].n), 1);
    console.log("[预检] 唯一标识冲突拒绝且数据/索引/迁移水位整体回滚通过");
    if (integration) await integration(clean);
  } finally {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    for (const name of created) {
      // 名称只来自上述固定前缀和数字；从未使用连接 URL 中的业务数据库名。
      await admin.unsafe(`DROP DATABASE "${name}"`);
    }
    await admin.end({ timeout: 5 });
    console.log("[预检] 隔离临时数据库已清理");
  }
}
