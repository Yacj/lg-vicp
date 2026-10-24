import { readFile, writeFile } from 'node:fs/promises'
const root = 'docs/ai/evidence/natural-dialogue-repair-2026-10-20'
const base = JSON.parse(await readFile(`${root}/round-12/business-review.json`, 'utf8'))
for (const round of ['round-17-final', 'round-18-final', 'round-19-final', 'round-21-final', 'round-22-final']) {
  const matrix = JSON.parse(await readFile(`${root}/${round}/matrix.json`, 'utf8'))
  const rows = structuredClone(base.turns)
  const overrides = {
    'S1-T2': ['PARTIAL', '保留产品范围且没有编造数值，但简化后仍以类别罗列为主，客户表达质量尚不足。'],
    'S4-T1': ['PARTIAL', '给出厚度、基层、防火固定、施工与成本核对维度；未直接提供有资料支持的产品优缺点。'],
    'S4-T2': ['PARTIAL', '仍主要要求明确比较对象，未提供新的同条件比较内容；不能判为完整咨询通过。'],
  }
  if (round !== 'round-17-final') Object.assign(overrides, {
    'S5-T2': ['PASS', '统一来源复核后返回唯一合格25mm正式行，保留200mm钢筋混凝土与Excel来源；35/25mm冲突行明确排除。'],
    'S5-T3': ['FAIL', '双方案比较未完成，且只给通用澄清，没有承接已知35mm绑定冲突。'],
    'S5-T4': ['PASS', '自然称呼由Backend绑定当前唯一整体法25mm候选，实际更新选用状态。'],
    'S5-T5': ['PASS', '实际指定Final并展示核对参数，未自动确认。'],
    'S5-T6': ['PASS', '真实H5确认按钮执行成功，实际形成不可变Snapshot；非仅文字提示。'],
    'S5-T7': ['PARTIAL', '真实H5生成入口已点击，报告可由后台继续生成；正式模板仍含内部免责声明占位，内容验收未通过。'],
  })
  if (round === 'round-19-final') Object.assign(overrides, {
    'S1-T2': ['PASS', '按当前表达要求简化产品介绍，沿用知识库范围与已确认事实。'],
    'R2-T3': ['PASS', '打开实际引用屋面原页并定位20mm；同一来源档位去重为两构造，未混淆产品R。'],
    'S5-T3': ['FAIL', '正确识别比较目标，但只有一个合格候选，双方案比较未完成；提示仍未具体承接35mm资料冲突。'],
    'R5-T5': ['FAIL', '方案与Final均未形成；空动作落入普通生成却声称已保持待确认，事实表达错误，后续修复。'],
  })
  if (round === 'round-21-final') Object.assign(overrides, {
    'S1-T2': ['PARTIAL', '产品范围与参数存在情况正确，但仍出现核验/本轮概览等内部措辞，后续收紧表达。'],
    'R2-T3': ['PASS', '实际屋面原页20mm档可打开，比较表保持两构造，重复来源已去重。'],
    'S5-T3': ['FAIL', '只有一个合格正式候选，双方案比较未完成；模型改走解释后提示来源不足，没有具体承接35mm绑定冲突。'],
    'R5-T4': ['PARTIAL', '如实说明当前没有已选方案，未虚构Final；前置选择失败，最终方案核对未完成。'],
    'R5-T5': ['PARTIAL', '空动作直接读取真实状态，明确没有形成待确认Final；快照/报告未增加，但完整待确认流程受前置阻塞。'],
  })
  if (round === 'round-22-final') Object.assign(overrides, {
    'S1-T2': ['PARTIAL', '保留产品范围且未再谈后台流程，但通俗追问仍偏长清单，“配套”等关联用语缺独立证据，质量未完全通过。'],
    'R2-T3': ['PASS', '实际屋面原页20mm档可打开，比较表保持两构造，重复来源已去重。'],
    'S5-T3': ['FAIL', '只有一条合格正式候选，无法完成整体25mm与分层35mm双方案比较；未伪造缺失候选。'],
    'R5-T4': ['PARTIAL', '缺少实际已选/Final前置，未能完成最终方案核对；未虚构正式方案。'],
    'R5-T5': ['PARTIAL', '按真实方案状态说明尚未形成待确认Final，未生成快照或报告；目标状态受前置阻塞。'],
  })
  for (const row of rows) {
    const [caseId, turn] = row.key.split('-T')
    const actual = matrix.cases.find(item => item.id === caseId).turns[Number(turn) - 1]
    if (actual.userMessage !== row.userMessage) throw new Error('Frozen question changed')
    const override = overrides[row.key]
    if (override) [row.status, row.reason] = override
    row.domainIntent = actual.backendDecision?.domainIntent
    row.policyReason = actual.backendDecision?.policyReason
  }
  const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL'].map(status => [status, rows.filter(row => row.status === status).length]))
  const result = { round, status: 'NOT_READY', reviewedAt: new Date().toISOString(),
    method: '逐轮阅读真实回答、最终决策、UI动作和来源证据；同一执行者审阅，不是独立人工盲测。原始执行状态未改写。',
    frozenSha256: matrix.frozenSha256, counts, turns: rows }
  await writeFile(`${root}/${round}/business-review.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ round, counts }))
}
