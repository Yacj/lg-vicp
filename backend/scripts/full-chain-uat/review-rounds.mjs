import { readFile, writeFile, readdir } from 'node:fs/promises'
const root = 'docs/ai/evidence/full-chain-uat-2026-10-19'
const overridesPath = `${root}/manual-review.json`
const reviews = JSON.parse(await readFile(overridesPath, 'utf8').catch(() => '{}'))
const result = { policy: 'Codex逐项业务复核与原始采集分开保存；没有完整业务复核的调试轮次只记PARTIAL，不以HTTP状态或模型拒绝记PASS。', rounds: [] }
const lines = ['# 各轮真实 H5 业务复核', '', result.policy, '']
for (const entry of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && e.name.startsWith('round-')).sort((a,b) => a.name.localeCompare(b.name))) {
  const matrix = await readFile(`${root}/${entry.name}/matrix.json`, 'utf8').then(JSON.parse).catch(() => null)
  if (!matrix) { result.rounds.push({ round: entry.name, turns: 0, status: reviews[entry.name]?._summary?.status ?? 'PARTIAL', note: reviews[entry.name]?._summary?.reason ?? '仅准备/环境轮次，未执行用户问题' }); continue }
  const rows = matrix.cases.flatMap(item => item.turns.map(turn => {
    const key = `${item.id}-T${turn.turn}`
    const review = reviews[entry.name]?.[key] ?? { status: 'PARTIAL', reason: '调试采集；未完整复核该轮所有业务与界面门槛，不能据HTTP成功计通过' }
    if (!['PASS', 'PARTIAL', 'FAIL'].includes(review.status)) throw Error('无效人工复核状态')
    return { key, question: turn.userMessage, ...review, intent: turn.backendDecision?.domainIntent, policyReason: turn.backendDecision?.policyReason,
      evidence: [`${entry.name}/${key}.sse.txt`, `${entry.name}/${key}.dom.json`, `${entry.name}/matrix.json`], answer: turn.answer }
  }))
  const counts = rows.reduce((a,row) => (a[row.status]++,a), {PASS:0,PARTIAL:0,FAIL:0})
  const summary = reviews[entry.name]?._summary
  const status = summary?.status === 'FAIL' || counts.FAIL ? 'FAIL' : summary?.status === 'PARTIAL' || counts.PARTIAL ? 'PARTIAL' : 'PASS'
  result.rounds.push({ round: entry.name, status, summary, counts, turns: rows.length, rows })
  await writeFile(`${root}/${entry.name}/business-review.json`, JSON.stringify({ status, counts, rows }, null, 2))
  lines.push(`## ${entry.name}：${status}`, '', summary?.reason ?? '', '', `执行 ${rows.length} 轮；PASS ${counts.PASS} / PARTIAL ${counts.PARTIAL} / FAIL ${counts.FAIL}。`, '', '| 轮次 | 状态 | 判定依据 | 证据 |', '| --- | --- | --- | --- |')
  for (const row of rows) lines.push(`| ${row.key} | ${row.status} | ${row.reason.replaceAll('|','／')} | [SSE](${row.evidence[0]}) / [DOM](${row.evidence[1]}) |`)
  lines.push('')
}
await writeFile(`${root}/all-round-business-review.json`, JSON.stringify(result, null, 2))
await writeFile(`${root}/all-round-business-review.md`, lines.join('\n'))
console.log(JSON.stringify(result.rounds.map(({ round, status, counts, turns }) => ({ round, status, counts, turns }))))
