import 'dotenv/config'
import postgres from 'postgres'
import { readFile, writeFile } from 'node:fs/promises'
const root = 'docs/ai/evidence/full-chain-uat-2026-10-19'
const env = JSON.parse(await readFile(`${root}/environment.json`, 'utf8'))
if (!/^vicp_h5_uat_[a-f0-9]{32}$/.test(env.databaseName)) throw Error('Expected isolated database')
const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || process.env.DATABASE_URL)
url.pathname = `/${env.databaseName}`
const db = postgres(url.toString(), { connection: { options: '-c default_transaction_read_only=on' } })
try {
  const models = { schemes: await db`select * from construction_schemes`, layers: await db`select * from construction_layers order by scheme_id,layer_order`, options: await db`select * from scheme_product_options` }
  await writeFile(`${root}/published-models.json`, JSON.stringify(models, null, 2))
  console.log({ schemes: models.schemes.length, layers: models.layers.length, options: models.options.length })
} finally { await db.end() }
