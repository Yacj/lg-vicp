/** 用户失败原话的只读语义取证；不创建会话、不调用业务写入。 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema.js";
import { resolveDomainTurn } from "../src/modules/ai/ai-domain-turn-decision.service.js";
import { loadThermalQueryDictionary } from "../src/modules/thermal/thermal-query-dictionary.service.js";
import { resolveQueryEntities } from "../src/modules/thermal/thermal-entity-resolver.js";
import { applySemanticQuery } from "../src/modules/thermal/semantic-query.js";
const out = process.argv[2] ?? "docs/ai/evidence/atlas-source-layout-2026-10-17/a3-diagnostic";
await mkdir(out, { recursive: true });
const client = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const db = drizzle(client, { schema });
  const dictionary = await loadThermalQueryDictionary(db);
  for (const [name, message] of [["single", "Ⅲ型VICP薄抹灰外保温系统，A3-2构造45mm，传热系数是多少？基层是什么？"], ["compare", "Ⅲ型VICP薄抹灰外保温系统，45mm厚度，不同基层的传热系数有什么区别？"]]) {
    const conversation = { id: randomUUID(), userId: randomUUID(), clientApp: "b_admin", scene: "general_chat", projectId: null };
    const decision = await resolveDomainTurn({ app: { db, log: { warn() {} } } as any, conversation: conversation as any, userMessage: message! });
    const proposal = decision.semantic?.pageQuery;
    const result = { name, readOnly: (await client`show transaction_read_only`)[0], decision,
      catalogMatches: resolveQueryEntities(message!, {}, dictionary.entities, dictionary.aliases),
      checked: proposal ? applySemanticQuery(message!, proposal, dictionary) : undefined };
    await writeFile(`${out}/${name}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ name, decision: decision.intent, reason: decision.policyReason, constraints: proposal?.constraints, unresolved: result.checked?.unresolved }));
  }
} finally { await client.end(); }
