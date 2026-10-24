import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root = resolve('docs/ai/evidence/full-chain-uat-2026-10-19')
const name = process.argv[2]
assert.match(name, /^round-\d{2}-[a-z-]+$/)
const out = resolve(root, name)
if (process.argv.includes('--refresh-before-start')) {
  assert.equal(await readFile(`${out}/environment.json`, 'utf8').then(() => true, () => false), false, '已启动轮次不能覆盖来源清单')
} else await mkdir(out) // 不覆盖既有证据
const template = await readFile(`${root}/server.mts`, 'utf8')
let observed = template.replace('if(tracked)upstream.push(entry);', `if(tracked){try{const b=JSON.parse(init?.body??'{}');entry.responseFormat=b.response_format?{type:b.response_format.type,schemaPresent:!!b.response_format.json_schema}:null;entry.model=b.model}catch{};upstream.push(entry)};`)
if (process.argv.includes('--approved-template')) {
  observed = observed.replace('const testB=randomUUID()', `const testAdmin=randomUUID()
  await db.insert(schema.users).values({id:testAdmin,phone:'19900000003',displayName:'UAT隔离模板管理员',role:'SUPER_ADMIN',status:'ACTIVE',adminLoginEnabled:true})
  await db.insert(schema.userAppAccess).values({userId:testAdmin,app:'ADMIN',role:'SUPER_ADMIN',status:'ACTIVE'})
  evidence.testAdminUserId=testAdmin
  const testB=randomUUID()`)
    .replace('for(const[file,exportName,routePrefix]of routes)', `routes.push(['reports/report-template.routes.ts','reportTemplateRoutes','/api/v1/platform/report-templates'])
  for(const[file,exportName,routePrefix]of routes)`)
    .replace("app.get('/__uat/evidence'", `app.get('/__uat/admin-token',async()=>({token:app.jwt.sign({sub:testAdmin,tokenType:'access',clientType:'B_ADMIN',aud:'admin',role:'SUPER_ADMIN',jti:randomUUID()})}))
  app.get('/__uat/evidence'`)
}
await writeFile(`${out}/server.mts`, observed.replace(`const directory="${root.replaceAll('\\', '/')}"`, `const directory="${out.replaceAll('\\', '/')}"`))
const manifest = {}
async function hashTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await hashTree(path)
    else if (entry.isFile()) manifest[relative(process.cwd(), path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
}
await hashTree(resolve('src'))
await hashTree(resolve('../app/src'))
await hashTree(resolve('../app/patches'))
for (const file of ['package.json', 'pnpm-lock.yaml', '../app/package.json', '../app/pnpm-lock.yaml']) {
  manifest[file] = createHash('sha256').update(await readFile(file)).digest('hex')
}
await writeFile(`${out}/source-manifest.json`, JSON.stringify(manifest, null, 2))
const cases = process.argv.slice(3).find(value => !value.startsWith('--'))
if (!process.argv.includes('--refresh-before-start')) await writeFile(`${out}/run-mode.json`, JSON.stringify(cases ? { cases: cases.split(',') } : {}))
console.log(JSON.stringify({ out, sourceFiles: Object.keys(manifest).length }))
