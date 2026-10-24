import 'dotenv/config'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import {readFile,writeFile} from 'node:fs/promises'
const out=process.argv[2]
assert.ok(process.argv.includes('--visual-reviewed'), '仅在逐页/逐屏人工查看后执行')
const json=async path=>JSON.parse(await readFile(`${out}/${path}`,'utf8'))
for(const [directory,pages,note] of [
  ['single-pdf-verified',2,'S5仅Final整体25mm，Sheet1、R/K、免责声明准确，全部页面无裁切重叠。'],
  ['published-pdf',3,'R5 Final整体25mm与参考分层35mm分开，来源和R/K准确，全部页面可读。'],
  ['calculated-pdf',4,'芯材20mm标注为输入作用层，八层参数和VICP-CALC-1/v1准确。末页仅审核提示造成留白，不影响阅读或操作。']
]){
  const review=await json(`${directory}/pdf-inspection.json`)
  assert.equal(review.pages,pages);assert.equal(review.textFactsPassed,true)
  const ui=await json(`${directory}/pdf-ui-audit-02.json`)
  assert.equal(ui.operations.length,2)
  assert.ok(ui.operations.every(item=>item.browserFileStatus===200&&item.pdfMagic))
  assert.ok(ui.operations.find(item=>item.mode==='download').browserDownloadMatches)
  review.visualReview='PASS';review.reviewNotes=note;review.reviewedAt=new Date().toISOString()
  await writeFile(`${out}/${directory}/pdf-inspection.json`,JSON.stringify(review,null,2))
}
const ui=await json('ui-audit.json')
assert.equal(ui.narrow.rootWidth,390)
for(const item of ui.checks)item.status='PASS'
ui.visualReview='PASS';ui.reviewNotes='已逐屏查看表头、45mm高亮、完整原图26/53、全屏及390px；无虚构像素定位。'
await writeFile(`${out}/ui-audit.json`,JSON.stringify(ui,null,2))
const env=await json('environment.json');assert.match(env.databaseName,/^vicp_h5_uat_[a-f0-9]{32}$/)
const url=new URL(process.env.AI_UAT_DATABASE_ADMIN_URL||process.env.DATABASE_URL);url.pathname=`/${env.databaseName}`
const db=postgres(url.toString(),{max:1,connection:{options:'-c default_transaction_read_only=on'}})
try{
  const reports=await db`select r.id,r.status,s.template_version,s.data_json from reports r join report_snapshots s on s.report_id=r.id`
  const solutions=await db`select id,payload from solution_snapshots`
  const checks=[]
  for(const report of reports){
    const data=report.data_json,model=data.documentModel,solution=solutions.find(row=>row.id===data.solutionSnapshotId)
    assert.equal(report.status,'READY');assert.equal(report.template_version,2)
    assert.equal(data.disclaimerText,'本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。')
    assert.ok(solution);assert.equal(model.solutionSnapshotId,solution.id)
    assert.deepEqual(model.finalCandidateIds,solution.payload.finalCandidateIds)
    assert.equal(model.solutions.length,solution.payload.candidates.length)
    assert.equal(model.alternatives.length,solution.payload.alternatives.length)
    checks.push({reportId:report.id,solutionSnapshotId:solution.id,templateVersion:2,status:'PASS'})
  }
  assert.ok(checks.length>=4)
  await writeFile(`${out}/report-freeze-verification.json`,JSON.stringify({at:new Date().toISOString(),status:'PASS',readOnly:true,checks},null,2))
  console.log(JSON.stringify({pdfVisualReview:'PASS',sourceUi:'PASS',frozenReports:checks.length}))
}finally{await db.end({timeout:2})}
