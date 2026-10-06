import { REPORT_TYPE_OPTIONS, reportTypeLabel, setReportTypeCatalog } from './reports.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, name: string) {
  if (condition) {
    passed += 1
    console.log(`ok  ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${name}`)
}

assert(REPORT_TYPE_OPTIONS.length === 0, '旧 REPORT_TYPE_OPTIONS 不再主导')
assert(!REPORT_TYPE_OPTIONS.some(item => item.value === 'energy_design'), 'energy_design 不再作为生成入口')
assert(!REPORT_TYPE_OPTIONS.some(item => item.value === 'design_note'), 'design_note 不再作为生成入口')
assert(!REPORT_TYPE_OPTIONS.some(item => item.value === 'marketing_copy'), 'marketing_copy 不再作为生成入口')

setReportTypeCatalog([
  { code: 'technical_scheme', name: '综合技术方案报告', description: '完整技术方案与依据', requiresProject: false, enabled: true },
  { code: 'project_brief', name: '项目方案简报', description: '更精炼的方案说明', requiresProject: false, enabled: true },
  { code: 'material_compare', name: '材料对比报告', description: '多种材料对比结果', requiresProject: false, enabled: true },
])
assert(reportTypeLabel('technical_scheme') === '综合技术方案报告', '动态报告类型优先使用 GET /reports/types')
assert(reportTypeLabel('material_compare', false) === '材料对比报告', '无 projectId 仍可展示类型名')
assert(reportTypeLabel('energy_design') === '建筑节能设计报告', '历史 code 仅作展示回退')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`reports tests failed: ${failed}`)
}
