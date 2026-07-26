import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../config/env.js";
import { createDatabase } from "./client.js";

const { db, client } = createDatabase(env);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.info("数据库迁移执行完成");
} catch (error) {
  console.error("数据库迁移执行失败", error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
