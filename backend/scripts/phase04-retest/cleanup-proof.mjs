import 'dotenv/config'
import postgres from 'postgres'
import { Redis } from 'ioredis'
import OSS from 'ali-oss'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const out = 'docs/ai/evidence/phase04-retest-2026-10-19'
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, connection: { options: '-c default_transaction_read_only=on' } })
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, retryStrategy: () => null })
redis.on('error', () => {})
const oss = new OSS({ region: process.env.OSS_REGION, bucket: process.env.STORAGE_BUCKET, accessKeyId: process.env.STORAGE_ACCESS_KEY, accessKeySecret: process.env.STORAGE_SECRET_KEY, endpoint: process.env.OSS_ENDPOINT || undefined, secure: true, internal: process.env.OSS_INTERNAL === 'true' })
const proof = { at: new Date().toISOString(), runs: [] }
try {
  await redis.connect()
  for (const run of ['h5-run-01', 'h5-run-02']) {
    const manifest = JSON.parse(await readFile(`${out}/${run}/environment.json`, 'utf8'))
    assert.match(manifest.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/)
    const id = manifest.databaseName.slice('vicp_h5_uat_'.length)
    assert.equal(manifest.prefix, `vicp-h5-uat-${id}`)
    const databases = await db`select datname from pg_database where datname=${manifest.databaseName}`
    let cursor = '0', keyCount = 0
    do { const result = await redis.scan(cursor, 'MATCH', `${manifest.prefix}:*`, 'COUNT', 200); cursor = result[0]; keyCount += result[1].length } while (cursor !== '0')
    let storage
    try { const objects = await oss.list({ prefix: `${manifest.prefix}/`, 'max-keys': 10 }, {}); storage = { status: 'CHECKED', objects: objects.objects?.length ?? 0, truncated: Boolean(objects.isTruncated) } }
    catch (error) { storage = { status: 'NOT_RUN', code: error.code ?? error.name, trackedWrites: manifest.writes.length } }
    proof.runs.push({ run, databaseName: manifest.databaseName, databaseExists: databases.length > 0, redisKeyCount: keyCount, storage, harnessCleanup: manifest.cleanup })
  }
  proof.passed = proof.runs.every(run => !run.databaseExists && run.redisKeyCount === 0 && run.harnessCleanup?.failures.length === 0 && run.storage.status === 'CHECKED' && run.storage.objects === 0 && !run.storage.truncated)
  await writeFile(`${out}/cleanup-proof.json`, JSON.stringify(proof, null, 2))
  console.log(JSON.stringify(proof))
} finally { redis.disconnect(); await db.end({ timeout: 2 }) }
