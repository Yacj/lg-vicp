import 'dotenv/config'
import postgres from 'postgres'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const evidenceRoot = process.argv[2] ?? 'docs/ai/evidence/full-chain-uat-2026-10-19'
const env = JSON.parse(await readFile(`${evidenceRoot}/environment.json`, 'utf8'))
assert.match(env.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/)
const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || process.env.DATABASE_URL)
url.pathname = `/${env.databaseName}`
const db = postgres(url.toString(), { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { options: '-c default_transaction_read_only=on' } })
assert.equal((await db`select current_database() as name`)[0].name, env.databaseName)
export async function getObservation() {
  return {
    conversations: await db`select id,user_id,client_app,title from ai_conversations order by created_at`,
    messages: await db`select id,conversation_id,role,content,status,metadata from ai_messages order by created_at`,
    states: await db`select * from ai_conversation_states`,
    solutions: await db`select id,conversation_id,stage,version,candidate_set_revision,confirmed_snapshot_id,payload from solution_states`,
    snapshots: await db`select * from solution_snapshots`,
    snapshotCount: (await db`select count(*)::int as n from solution_snapshots`)[0].n,
    reports: await db`select id,conversation_id,status,error_message,content_json from reports`,
    calculations: await db`select id,mode,input_json,result_json from thermal_calc_records`,
    tools: await db`select * from ai_tool_calls`,
  }
}
export async function closeObservation() { await db.end({ timeout: 2 }) }
export async function withModelsUnavailable(action) {
  assert.notEqual(url.pathname, new URL(process.env.DATABASE_URL).pathname)
  const isolated = postgres(url.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} })
  assert.equal((await isolated`select current_database() as name`)[0].name, env.databaseName)
  const models = await isolated`select id,enabled from ai_models`
  try {
    await isolated`update ai_models set enabled=false`
    return await action({ disabledModels: models.length })
  } finally {
    for (const model of models) await isolated`update ai_models set enabled=${model.enabled} where id=${model.id}`
    const after = await isolated`select id,enabled from ai_models order by id`
    assert.deepEqual(Array.from(after), Array.from(models).sort((a, b) => a.id.localeCompare(b.id)))
    await isolated.end({ timeout: 2 })
  }
}
export async function readModelState() { return Array.from(await db`select id,enabled from ai_models order by id`) }
