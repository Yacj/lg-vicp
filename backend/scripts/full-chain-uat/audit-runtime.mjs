import 'dotenv/config'
import postgres from 'postgres'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { getObservation, closeObservation } from './observation.mjs'
const out = process.argv[2] ?? 'docs/ai/evidence/full-chain-uat-2026-10-19/round-01-targeted'
const manifest = JSON.parse(await readFile(`${out}/environment.json`, 'utf8'))
assert.match(manifest.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/)
const url = new URL(process.env.DATABASE_URL); url.pathname = `/${manifest.databaseName}`
const db = postgres(url.toString(), { max: 1, connect_timeout: 5, connection: { options: '-c default_transaction_read_only=on' } })
try {
  assert.equal((await db`select current_database() as name`)[0].name, manifest.databaseName)
  const models = await db`select id,code,model_id,reasoning_level,enabled,last_test_status from ai_models`
  const scenes = await db`select code,default_model_id,reasoning_model_id,allow_reasoning,allow_tools,allow_knowledge_search,enabled from ai_scenes`
  const promptRows = await db`select p.code,v.version,v.status,v.content from prompts p left join prompt_versions v on v.id=p.active_version_id`
  const prompts = promptRows.map(({ content, ...row }) => ({ ...row, contentSha256: content ? createHash('sha256').update(content).digest('hex') : null }))
  const state = await getObservation()
  const sanitize = text => text.replace(/https?:[^\s"<>]+/g, url => url.split('?')[0])
  await writeFile(`${out}/final-backend-state.json`, sanitize(JSON.stringify(state, null, 2)))
  const runtime = { at: new Date().toISOString(), models, scenes, prompts, roles: state.messages.reduce((counts, message) => (counts[message.role] = (counts[message.role] ?? 0) + 1, counts), {}), counts: { conversations: state.conversations.length, solutionStates: state.solutions.length, snapshots: state.snapshotCount, reports: state.reports.length, calculations: state.calculations.length }, tokenUsage: '未完整采集上游每次请求usage，不以用户轮数或Domain提案数推算', browser: 'Microsoft Edge headless，独立上下文；1280x900和390x844', node: process.version }
  await writeFile(`${out}/runtime-audit.json`, JSON.stringify(runtime, null, 2))
  console.log(JSON.stringify({ models: models.map(model => model.model_id), roles: runtime.roles, counts: runtime.counts }))
} finally { await db.end({ timeout: 2 }); await closeObservation() }
