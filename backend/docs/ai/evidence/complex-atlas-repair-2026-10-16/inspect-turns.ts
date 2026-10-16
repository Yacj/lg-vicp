/** 仅本次随机测试库只读取证；不输出连接、模型配置或凭据。 */
import "dotenv/config";
import postgres from "postgres";
import { readFile, writeFile } from "node:fs/promises";
const dir = "docs/ai/evidence/complex-atlas-repair-2026-10-16/real-uat";
const report = JSON.parse(await readFile(`${dir}/report.json`, "utf8"));
if (!/^vicp_ai_uat_[a-f0-9]{32}$/.test(report.isolation.database)) throw Error("仅本次随机库");
const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${report.isolation.database}`;
const db = postgres(url.toString(), { max: 1, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const result = [];
  for (const item of report.cases) {
    const messages = await db`select content, metadata from ai_messages where conversation_id=${item.conversationId} and role='ASSISTANT' order by created_at desc`;
    result.push({ id: item.id, decisions: messages.map(message => ({ backendDecision: message.metadata?.backendDecision })) });
  }
  await writeFile(`${dir}/backend-decisions.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.find(item => item.id === "T06")));
} finally { await db.end(); }
