// 审计已保存的浏览器DOM；仅看同一构造同一grid行，不把空单元格转为数字0。
import fs from 'node:fs'
const root = new URL('./', import.meta.url)
const read = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'))
const expected = {
  89: [[5.225, .191], [5.198, .192], [6.025, .166], [5.998, .167]],
  90: [[5.369, .186], [5.369, .186], [6.169, .162], [6.169, .162]],
  75: [[6.916, .145], [7.540, .133], [8.516, .117], [9.140, .109]],
}
const rowsFor = source => read(source).flatMap(page => page.groups.flatMap((group, i) => [20, 25].map(thicknessMm => {
  const candidates = group.cells.filter(c => c.column === '3' && Number(c.text) === thicknessMm).flatMap(c => {
    const r = group.cells.find(x => x.row === c.row && x.column === '8')
    const k = group.cells.find(x => x.row === c.row && x.column === '9')
    return r?.text.trim() && k?.text.trim() ? [{ r: Number(r.text), k: Number(k.text) }] : []
  })
  const [r, k] = expected[page.page][(thicknessMm === 20 ? 0 : 2) + i]
  return { page: page.page, group: group.label, groupId: group.id, thicknessMm, expectedR: r, expectedK: k,
    actual: candidates, status: candidates.length === 1 && candidates[0].r === r && candidates[0].k === k ? 'PASS' : 'FAIL' }
})))
const fixture = rowsFor('browser/h5-three-pages.json')
const realReadOnly = rowsFor('browser/h5-real-three-pages.json')
const b = read('browser/b-six-qa-fixture.json').map(item => {
  const data = item.text.split('\n').filter(line => line.includes('\t')).map(line => line.split('\t'))
    .filter(c => c.length === 5 && Number(c[1]) === item.thickness)
  const baseline = expected[item.page].slice(item.thickness === 20 ? 0 : 2, item.thickness === 20 ? 2 : 4)
  return { page: item.page, thicknessMm: item.thickness, rows: data,
    status: data.length === 2 && data.every((c, i) => Number(c[2]) === baseline[i][0] && Number(c[3]) === baseline[i][1] && Number(c[4]) === item.page) ? 'PASS' : 'FAIL' }
})
const result = { scope: 'H5 Fixture/真实只读GET全表与B Fixture问答；自然模型SSE本轮NOT_RUN', fixture, realReadOnly, adminFixture: b }
fs.writeFileSync(new URL('browser/twelve-rows-validation.json', root), JSON.stringify(result, null, 2))
const failed = [...fixture, ...realReadOnly, ...b].filter(row => row.status !== 'PASS')
console.log(JSON.stringify({ h5Fixture: `${fixture.length - fixture.filter(r => r.status === 'FAIL').length}/${fixture.length}`,
  h5RealReadOnly: `${realReadOnly.length - realReadOnly.filter(r => r.status === 'FAIL').length}/${realReadOnly.length}`,
  adminFixtureQueries: `${b.length - b.filter(r => r.status === 'FAIL').length}/${b.length}`, failed }, null, 2))
if (failed.length) process.exitCode = 1
