import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import * as schema from "../../src/db/schema.js";
import { resolveSceneRuntime } from "../../src/modules/ai/ai-runtime.service.js";
import { reviewParameterIdentity } from "../../src/modules/ai/parameter-identity-semantic.js";
const out = process.argv[2]!;
const environment = JSON.parse(await readFile(`${out}/environment.json`, "utf8"));
assert.match(environment.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/);
const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || process.env.DATABASE_URL!); url.pathname = `/${environment.databaseName}`;
const client = postgres(url.toString(), { max: 1, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const db = drizzle(client, { schema });
  const runtime = await resolveSceneRuntime(db, "semantic_query", "OFF").catch(() => resolveSceneRuntime(db, "general_chat", "OFF"));
  const records: unknown[] = [];
  for (const message of ["有保温0.3的材料吗？\n导热系数。", "VLCP的导热系数λ等于0.3有哪些？"]) {
    let proposal: unknown;
    try { const result = await reviewParameterIdentity(runtime.primary.languageModel, message, AbortSignal.timeout(45000), value => { proposal = value; }, message === "有保温0.3的材料吗？\n导热系数。" ? "有保温0.3的材料吗？导热系数。" : undefined); records.push({ message, proposal, result }); }
    catch (error) { records.push({ message, proposal, error: error instanceof Error ? { name: error.name, message: error.message } : "UNKNOWN" }); }
  }
  await writeFile(`${out}/parameter-identity-probe.json`, JSON.stringify(records, null, 2));
  console.log(JSON.stringify(records));
} finally { await client.end({ timeout: 2 }); }
