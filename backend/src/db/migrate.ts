import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../config/env.js";
import { createDatabase } from "./client.js";

const { db, client } = createDatabase(env);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.info("数据库迁移执行完成");
} catch (error) {
  console.error("数据库迁移执行失败");
  console.error("请检查 drizzle/ 迁移文件与数据库状态；已执行过的迁移不可修改，需要修复时请新增迁移文件");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
