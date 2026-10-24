import { execFileSync } from 'node:child_process'
import { readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve('..')
const evidence = 'docs/ai/evidence/full-chain-uat-2026-10-19'
const git = args => execFileSync('git', ['-c','core.quotepath=false',...args], { cwd: root, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).split('\n').filter(Boolean)
const tracked = git(['diff','--name-only'])
const untracked = git(['ls-files','--others','--exclude-standard'])
const files = []
for (const file of [...new Set([...tracked, ...untracked])].sort()) {
  if (!file.startsWith('backend/') && !file.startsWith('app/')) continue
  if (file.includes('/docs/ai/evidence/') || file.startsWith('app/.patchwork/')) continue
  const path = resolve(root, file)
  const data = await readFile(path)
  const category = file.startsWith('backend/scripts/') || file.startsWith('backend/tests/') ? '验收工具/冻结fixture' : file.includes('/docs/') || /(?:AGENTS|README|\.mdc|SKILL)/.test(file) ? '文档/治理' : /test\.|fixtures/.test(file) ? '自动测试/fixture' : file.endsWith('.json') && file.includes('/shared/') ? '核对后的显示投影数据' : '产品实现/构建配置'
  files.push({ path:file, status: tracked.includes(file)?'MODIFIED':'ADDED', category, bytes:(await stat(path)).size, sha256:createHash('sha256').update(data).digest('hex') })
}
await writeFile(`${evidence}/changed-files.json`, JSON.stringify({ baseline:'85597b96655ddda1e9aea2047eac21bf290dfdfd', note:'本轮及阶段03/04尚未提交的累计交付；真实证据、临时patch目录另列。无提交、推送或部署。', files },null,2))
await writeFile(`${evidence}/changed-files.md`, ['# 修改文件清单','',`累计 ${files.length} 个实现、测试、工具和文档文件；详见 JSON 的 SHA256。证据文件单独保留，app/.patchwork 为临时目录。`,'','| 文件 | 状态 | 用途 |','| --- | --- | --- |',...files.map(f=>`| ${f.path} | ${f.status} | ${f.category} |`)].join('\n'))
const cleanup = []
for (const dir of ['',...(await readdir(evidence,{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name.startsWith('round-')).map(d=>`/${d.name}`)]) {
  const proof = await readFile(`${evidence}${dir}/independent-cleanup-proof.json`,'utf8').then(JSON.parse).catch(()=>null)
  if (proof) cleanup.push({directory:dir||'root-precheck',...proof})
}
await writeFile(`${evidence}/cleanup-summary.json`,JSON.stringify({at:new Date().toISOString(),runs:cleanup,allVerified:cleanup.every(item=>item.passed)},null,2))
console.log(JSON.stringify({changedFiles:files.length,cleanupProofs:cleanup.length,allAvailableCleanupProofsPassed:cleanup.every(item=>item.passed)}))
