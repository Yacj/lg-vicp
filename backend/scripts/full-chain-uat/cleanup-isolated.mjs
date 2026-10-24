import 'dotenv/config'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import postgres from 'postgres'
import { Redis } from 'ioredis'
import OSS from 'ali-oss'
const root = resolve('docs/ai/evidence/full-chain-uat-2026-10-19')
const out = resolve(process.argv[2])
assert.ok(out === root || out.startsWith(root + sep))
const manifest = JSON.parse(await readFile(`${out}/environment.json`, 'utf8'))
assert.match(manifest.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/)
assert.equal(manifest.prefix, manifest.databaseName.replace('vicp_h5_uat_', 'vicp-h5-uat-'))
assert.notEqual(new URL(process.env.DATABASE_URL).pathname, `/${manifest.databaseName}`)
const live = await fetch('http://127.0.0.1:3329/__uat/readiness', { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null)
assert.notEqual(live?.databaseName, manifest.databaseName, '禁止清理当前仍在运行的UAT')
const mutate = process.argv.includes('--cleanup')
const db = postgres(process.env.AI_UAT_DATABASE_ADMIN_URL || process.env.DATABASE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} })
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, retryStrategy: () => null }); redis.on('error', () => {})
const oss = new OSS({ region: process.env.OSS_REGION, bucket: process.env.STORAGE_BUCKET, accessKeyId: process.env.STORAGE_ACCESS_KEY, accessKeySecret: process.env.STORAGE_SECRET_KEY, endpoint: process.env.OSS_ENDPOINT || undefined, secure: true, internal: process.env.OSS_INTERNAL === 'true' })
async function keys() { let cursor = '0'; const all = []; do { const reply = await redis.scan(cursor, 'MATCH', `${manifest.prefix}:*`, 'COUNT', 200); cursor = reply[0]; all.push(...reply[1]) } while (cursor !== '0'); return all }
async function objects() { const all = []; let marker; do { const result = await oss.list({ prefix: `${manifest.prefix}/`, marker, 'max-keys': 1000 }, {}); all.push(...(result.objects ?? []).map(o => o.name)); marker = result.isTruncated ? result.nextMarker : undefined } while (marker); return all }
async function storageState() { try { return { status: 'CHECKED', keys: await objects() } } catch (error) { return { status: 'UNAVAILABLE', http: error.status, code: error.code ?? error.name, requestId: error.requestId } } }
try {
  await redis.connect()
  const beforeKeys = await keys(), beforeStorage = await storageState(), beforeObjects = beforeStorage.keys ?? []
  assert.ok(beforeKeys.every(key => key.startsWith(`${manifest.prefix}:`)))
  assert.ok(beforeObjects.every(key => key.startsWith(`${manifest.prefix}/`)))
  const beforeDatabase = (await db`select datname from pg_database where datname=${manifest.databaseName}`).length > 0
  if (mutate) {
    if (beforeKeys.length) await redis.del(...beforeKeys)
    if (beforeObjects.length) await oss.deleteMulti(beforeObjects, { quiet: true })
    if (beforeDatabase) {
      await db`select pg_terminate_backend(pid) from pg_stat_activity where datname=${manifest.databaseName} and pid<>pg_backend_pid()`
      await db.unsafe(`DROP DATABASE "${manifest.databaseName}"`)
    }
  }
  const afterStorage = beforeStorage.status === 'CHECKED' ? await storageState() : beforeStorage
  const proof = { at: new Date().toISOString(), isolatedPrefix: manifest.prefix, mode: mutate ? 'CLEANUP_OWN_ISOLATED_RESOURCES' : 'READ_ONLY_VERIFICATION', before: { databaseExists: beforeDatabase, redisKeys: beforeKeys.length, objects: beforeStorage.keys?.length ?? null },
    after: { databaseExists: (await db`select datname from pg_database where datname=${manifest.databaseName}`).length > 0, redisKeys: (await keys()).length, objects: afterStorage.keys?.length ?? null }, storage: { ...afterStorage, keys: undefined } }
  proof.passed = !proof.after.databaseExists && proof.after.redisKeys === 0 && proof.after.objects === 0 && afterStorage.status === 'CHECKED'
  await writeFile(`${out}/independent-cleanup-proof.json`, JSON.stringify(proof, null, 2)); console.log(JSON.stringify(proof))
} finally { redis.disconnect(); await db.end({ timeout: 2 }) }
