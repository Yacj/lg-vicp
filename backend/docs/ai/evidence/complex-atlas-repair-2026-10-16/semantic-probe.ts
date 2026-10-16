import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readFile, writeFile } from "node:fs/promises";
import * as schema from "../../../../src/db/schema.js";
import { resolveDomainTurn } from "../../../../src/modules/ai/ai-domain-turn-decision.service.js";
const dir = "docs/ai/evidence/complex-atlas-repair-2026-10-16/real-uat";
const report = JSON.parse(await readFile(`${dir}/report.json`, "utf8"));
if (!/^vicp_ai_uat_[a-f0-9]{32}$/.test(report.isolation.database)) throw Error("仅随机隔离库");
const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${report.isolation.database}`;
const client = postgres(url.toString(), { max: 1, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const item = report.cases.find((row: any) => row.id === "T06");
  const [conversation] = await client`select * from ai_conversations where id=${item.conversationId}`;
  const app = { db: drizzle(client, { schema }), log: { warn: () => {} } };
  const results = [];
  for (let run = 0; run < 3; run++) {
    const result = await resolveDomainTurn({ app, conversation: { id: conversation!.id, userId: conversation!.user_id, projectId: null, clientApp: "c_app", scene: "general_chat" }, userMessage: item.question, taskState: { taskType: "GENERAL" } } as any);
    results.push({ run, ...result }); console.log(JSON.stringify({ run, intent: result.intent, reason: result.policyReason, query: result.semantic?.pageQuery, unresolved: result.unresolved }));
    await writeFile(`${dir}/semantic-probe.json`, JSON.stringify(results, null, 2));
  }
} finally { await client.end(); }
