import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { createDatabase } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");
const STATEMENT_BREAK = "--> statement-breakpoint";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/**
 * 迁移执行器（生产环境使用，替代 drizzle-orm 默认 migrator）：
 * - 迁移文件中的每条语句在事务外单独执行。项目迁移可能包含
 *   `ALTER TYPE ... ADD VALUE`（如 ai_message_status 增加 BLOCKED），
 *   Postgres 禁止该语句在事务块内执行，默认 migrator 会把整个文件包在事务里导致失败。
 * - 幂等与记录机制与 drizzle 一致：已执行过的迁移（created_at 不早于记录中最大值）自动跳过，
 *   成功后写入 drizzle.__drizzle_migrations（hash + created_at）。
 * - 语句失败立即中止并提示，已执行的语句不会回滚；恢复时重新执行整个文件可能重复命中
 *   ALTER TYPE 等语句，需要人工按报错处理（与 Postgres 迁移语义一致，不支持中途断点恢复）。
 */
const { db, client } = createDatabase(env);

try {
  if (!existsSync(JOURNAL_PATH)) {
    throw new Error(`找不到迁移日志 ${JOURNAL_PATH}，请确认代码完整`);
  }
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const [lastRow] = await db.execute<{ created_at: number }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
  );
  const lastCreatedAt = lastRow?.created_at ?? null;

  let executed = 0;
  for (const entry of journal.entries) {
    if (lastCreatedAt !== null && lastCreatedAt >= entry.when) continue;
    const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(file)) throw new Error(`找不到迁移文件 ${file}`);
    const content = readFileSync(file, "utf8");
    const statements = content.split(STATEMENT_BREAK)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
    const hash = createHash("sha256").update(content).digest("hex");
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${entry.when})`
    );
    console.info(`数据库迁移已执行：${entry.tag}`);
    executed += 1;
  }
  console.info(`数据库迁移执行完成${executed === 0 ? "（无待执行迁移）" : `（本次执行 ${executed} 个）`}`);
} catch (error) {
  console.error("数据库迁移执行失败");
  console.error("请检查 drizzle/ 迁移文件与数据库状态；已执行过的迁移不可修改，需要修复时请新增迁移文件");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}