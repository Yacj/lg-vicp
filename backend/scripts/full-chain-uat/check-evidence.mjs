import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative } from 'node:path'
const root = resolve('docs/ai/evidence/full-chain-uat-2026-10-19')
const out = process.argv[2]
const manifest = JSON.parse(await readFile(`${out}/source-manifest.json`,'utf8'))
const shadow = 'C:/Users/admin/AppData/Local/Temp/vicp-final-uat-h5'
const differences = []
let compared=0
for (const file of Object.keys(manifest).filter(file=>file.startsWith('../app/src/'))) {
  const target = `${shadow}/${file.slice('../app/'.length)}`
  const hash = await readFile(target).then(data=>createHash('sha256').update(data).digest('hex')).catch(()=>null)
  if (hash !== manifest[file]) differences.push({file, runtime:!file.endsWith('.d.ts') && !/\.(?:test|spec)\./.test(file)})
  compared++
}
const findings = []
let scanned=0
async function scan(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const file=resolve(directory,entry.name)
    if (entry.isDirectory()) {await scan(file);continue}
    if (!/\.(json|ndjson|txt|md)$/.test(entry.name)) continue
    const text=await readFile(file,'utf8');scanned++
    const kinds=[]
    if (/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+/.test(text)) kinds.push('JWT')
    if (/[?&](?:Signature|X-Amz-Signature|OSSAccessKeyId|x-oss-signature)=/i.test(text)) kinds.push('SIGNED_URL_QUERY')
    if (/"(?:password|apiKey|accessToken|refreshToken|accessKeySecret)"\s*:\s*"(?!\[REDACTED\]|\*+|redacted)[^"\s]{8,}"/i.test(text)) kinds.push('CREDENTIAL_VALUE')
    if(kinds.length)findings.push({file:relative(root,file),kinds})
  }
}
await scan(root)
const result={at:new Date().toISOString(),shadow:{compared,differences,passed:!differences.some(item=>item.runtime)},privacy:{scanned,findings,passed:findings.length===0}}
const previous=await readFile(`${out}/delivery-check.json`,'utf8').catch(()=>null)
if(previous)await writeFile(`${out}/delivery-check-before-${Date.now()}.json`,previous)
await writeFile(`${out}/delivery-check.json`,JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
