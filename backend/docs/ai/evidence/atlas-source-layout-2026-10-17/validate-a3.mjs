import fs from 'node:fs'
import assert from 'node:assert/strict'
const out = import.meta.dirname
const checks = []
for (const run of ['a3-acceptance', 'a3-repeat']) {
  const report = JSON.parse(fs.readFileSync(`${out}/${run}/report.json`))
  assert.equal(report.cleanup, 'PASS')
  for (const [name, count, ks] of [['b-a3-single', 1, [.294]], ['b-a3-compare', 4, [.248, .293, .294, .302]], ['A3_SINGLE', 1, [.294]], ['A3_COMPARE', 4, [.248, .293, .294, .302]], ['A3_FOLLOWUP', 1, [.294]]]) {
    const record = JSON.parse(fs.readFileSync(`${out}/${run}/${name}.json`))
    const answer = record.answer ?? record.events.filter(e => e.event === 'delta').map(e => e.data.text ?? '').join('')
    assert.equal(record.facts.length, count)
    assert.deepEqual(record.facts.map(f => Number(f.k)).sort(), ks)
    if (!name.includes('FOLLOWUP')) for (const k of ks) assert.ok(answer.includes(k.toFixed(3)))
    if (count === 1) { assert.ok(answer.includes('混凝土空心砌块')); assert.ok(answer.includes('190mm')) }
    assert.ok(!answer.includes('指定实体尚未匹配') && !answer.includes('体系族尚无可靠'))
    assert.ok(!answer.includes('**3.000') && !answer.includes('**3.313'))
    if (record.historyReturned != null) {
      assert.equal(record.historyReturned, true); assert.equal(record.persistedUrlFree, true)
      assert.equal(record.solutionStates, 0); assert.equal(record.reports, 0); assert.equal(record.snapshots, 0)
    }
    checks.push({ run, name, count, ks, status: 'PASS' })
  }
}
fs.writeFileSync(`${out}/a3-validation.json`, JSON.stringify({ scope: '两轮真实模型及隔离HTTP/SSE；原图45mm人工事实基线；非生产会话', status: 'PASS', checks }, null, 2))
console.log(JSON.stringify({ status: 'PASS', testedTurns: checks.length, repeatRuns: 2 }))
