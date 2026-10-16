/** 业务源库只读校验及本轮交付文件凭据泄露检查，不输出秘密值。 */
import "dotenv/config";
import postgres from "postgres";
import { readdir, readFile, writeFile } from "node:fs/promises";
const root = "docs/ai/evidence/complex-atlas-repair-2026-10-16";
const db = postgres(process.env.DATABASE_URL!, { max: 1, connection: { options: "-c default_transaction_read_only=on" } });
try {
  const before = JSON.parse(await readFile("docs/ai/evidence/complex-atlas-review-2026-10-16/environment-after.json", "utf8")).sourceInventory;
  const inventory: Record<string, number> = {};
  for (const table of ["thermal_reference_rows", "knowledge_pages", "solution_snapshots", "reports", "thermal_candidate_selections", "ai_conversations"]) {
    inventory[table] = Number((await db`select count(*)::int as count from ${db(table)}`)[0]!.count);
  }
  const [options] = await db`select sum(jsonb_array_length(system->'options'))::int as count from knowledge_pages, jsonb_array_elements(metadata->'confirmedStructuredData'->'systems') system`;
  const secrets = ["STORAGE_ACCESS_KEY","STORAGE_SECRET_KEY","AI_CONFIG_ENCRYPTION_KEY","JWT_SECRET"].map(key => process.env[key]).filter((value): value is string => !!value && value.length >= 12);
  const leaks: string[] = [];
  async function scan(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(name);
      else if (/\.(?:json|log|md|txt|ts|mjs|js|vue)$/.test(name)) {
        const contents = await readFile(name,"utf8"); if (secrets.some(value => contents.includes(value))) leaks.push(name);
      }
    }
  }
  await scan(root);
  const result = { scope: "业务源库只读计数核对，非所有旧行内容hash；本轮目录秘密字符串检查", provider: process.env.STORAGE_PROVIDER, transactionReadOnly: (await db`show transaction_read_only`)[0]!.transaction_read_only,
    inventory, baseline: before, unchangedCounts: JSON.stringify(inventory) === JSON.stringify(before), confirmedOptions: options!.count, credentialLeakFiles: leaks };
  await writeFile(`${root}/source-after.json`, JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { await db.end(); }
