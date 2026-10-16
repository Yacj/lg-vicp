/** 阶段5预检：强制只读源库、Redis仅PING；不创建库/队列/对象，不输出连接或凭据。 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { Redis } from "ioredis";

const output = path.resolve(process.argv[2] ?? "docs/ai/evidence/complex-atlas-phase5/environment.json");
const report: Record<string, unknown> = { scope: "真实依赖只读预检，不是业务UAT", startedAt: new Date().toISOString(), writes: 0 };
const failure = (error: unknown) => {
  const value = error as { name?: string; code?: string };
  return { name: value.name ?? "UNKNOWN", code: value.code ?? "UNKNOWN" };
};
report.configuration = Object.fromEntries(["DATABASE_URL", "AI_UAT_DATABASE_ADMIN_URL", "AI_UAT_CONFIG_DATABASE_URL", "REDIS_URL", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "AI_CONFIG_ENCRYPTION_KEY"].map(key => [key, Boolean(process.env[key])]));
const client = postgres(process.env.AI_UAT_CONFIG_DATABASE_URL ?? process.env.DATABASE_URL ?? "", {
  max: 1, connect_timeout: 5, onnotice: () => {},
  connection: { options: "-c default_transaction_read_only=on -c statement_timeout=5000" },
});
try {
  const [mode] = await client`show transaction_read_only`;
  if (mode?.transaction_read_only !== "on") throw new Error("只读连接保护未生效");
  const [role] = await client`select rolcreatedb, rolsuper from pg_roles where rolname = current_user`;
  report.database = { status: "PASS", transactionReadOnly: mode.transaction_read_only, roleCanCreateDatabase: Boolean(role?.rolcreatedb || role?.rolsuper) };
  const counts: Record<string, unknown> = {};
  for (const table of ["thermal_reference_rows", "knowledge_pages", "solution_snapshots", "reports", "thermal_candidate_selections", "ai_conversations"]) {
    try { counts[table] = (await client`select count(*)::int as total from ${client(table)}`)[0]?.total; }
    catch (error) { counts[table] = failure(error); }
  }
  report.sourceInventory = counts;
  report.models = await client`select enabled, last_test_status, count(*)::int as count from ai_models group by enabled, last_test_status`;
  report.scenes = await client`select code, enabled, allow_tools, allow_knowledge_search from ai_scenes where code = 'general_chat'`;
} catch (error) { report.database = { status: "NOT_RUN", error: failure(error) }; }
finally { await client.end({ timeout: 3 }); }

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: true, connectTimeout: 3000, retryStrategy: () => null, maxRetriesPerRequest: 0 });
redis.on("error", () => {});
try { await redis.connect(); report.redis = { status: await redis.ping() === "PONG" ? "PASS" : "FAIL", operation: "PING_ONLY" }; }
catch (error) { report.redis = { status: "NOT_RUN", error: failure(error) }; }
finally { redis.disconnect(); }
report.finishedAt = new Date().toISOString();
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
