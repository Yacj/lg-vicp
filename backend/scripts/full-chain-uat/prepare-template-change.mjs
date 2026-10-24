import 'dotenv/config'
import postgres from 'postgres'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const out = process.argv[2]
const manifest = JSON.parse(await readFile(`${out}/environment.json`, 'utf8'))
assert.match(manifest.databaseName, /^vicp_h5_uat_[a-f0-9]{32}$/)
assert.ok(manifest.testAdminUserId, '仅允许显式模板验收夹具')
const live = await (await fetch('http://127.0.0.1:3329/__uat/readiness')).json()
assert.equal(live.databaseName, manifest.databaseName)
const url = new URL(process.env.AI_UAT_DATABASE_ADMIN_URL || process.env.DATABASE_URL); url.pathname = `/${manifest.databaseName}`
const db = postgres(url.toString(), {max:1,connection:{options:'-c default_transaction_read_only=on'}})
const text = '本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。'
const result = { scope:'用户确认文案的模板新版本准备；只读生产来源，在独立随机库通过真实HTTP及原权限/审核/发布状态机验证，不写生产或历史快照', approvedText:text, drafts:[], workflow:[] }
const save = () => writeFile(`${out}/approved-template-change.json`,JSON.stringify(result,null,2))
const base = 'http://127.0.0.1:3329/api/v1/platform/report-templates'
async function request(path,token,method='POST',body) {
  const response = await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
  return {http:response.status,...(await response.json())}
}
try {
  const templates = await db`select id,code,version,status,sections_json from report_templates where status='PUBLISHED' order by code`
  const credentials = JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-final-uat-private-login.json','utf8'))
  const login = await (await fetch('http://127.0.0.1:3329/api/v1/auth/client/login/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,clientType:'C_APP'})})).json()
  assert.equal(login.success,true)
  const forbidden = await request(`/${templates[0].id}/new-version`, login.data.accessToken,'POST',{changeNote:'权限负测，不应创建草稿'})
  assert.equal(forbidden.success,false); result.clientDenied={http:forbidden.http,errorCode:forbidden.error?.code}
  const token = (await (await fetch('http://127.0.0.1:3329/__uat/admin-token')).json()).token
  for (const template of templates) {
    const sections = template.sections_json.map(section => section.key === 'disclaimer' ? {...section,content:text} : section)
    assert.ok(sections.some(section=>section.key==='disclaimer'))
    const draft = {code:template.code,basedOnId:template.id,basedOnVersion:template.version,
      basedOnSectionsSha256:createHash('sha256').update(JSON.stringify(template.sections_json)).digest('hex'),
      changeNote:'2026-10-19 用户确认免责声明正文，仅移除内部占位说明；工程/审核提示及其他章节不变',sections}
    result.drafts.push(draft); await save()
    const created = await request(`/${template.id}/new-version`,token,'POST',{changeNote:draft.changeNote})
    assert.equal(created.success,true,JSON.stringify(created.error)); const id = created.data.item.id
    for (const [action,method,body] of [['','PATCH',{sections,changeNote:draft.changeNote}],['/validate','POST',null],['/submit','POST',null],['/approve','POST',{approvalNote:'独立验收库：用户已确认正文，验证模板发布流程'}],['/publish','POST',null]]) {
      const response = await request(`/${id}${action}`,token,method,body)
      result.workflow.push({code:template.code,templateId:id,action:action||'PATCH',http:response.http,success:response.success,errorCode:response.error?.code})
      await save(); assert.equal(response.success,true,JSON.stringify(response.error))
      if(action==='/validate') assert.equal(response.data.valid,true)
    }
    draft.isolatedPublishedVersion=created.data.item.version
    const old = (await db`select sections_json,status from report_templates where id=${template.id}`)[0]
    assert.deepEqual(old.sections_json,template.sections_json)
    assert.equal(old.status,'DISABLED')
  }
  result.status='PASS'; result.oldTemplateContentUnchanged=true; result.productionWrites=0; await save()
  await writeFile('docs/ai/approved-report-template-change-2026-10-19.json',JSON.stringify({approval:'用户已确认，准备模板变更；生产尚未执行',approvedText:text,workflow:'new-version → PATCH sections → validate → submit → approve → publish；必须由有权管理员执行',drafts:result.drafts.map(({isolatedPublishedVersion,...draft})=>draft)},null,2))
  console.log(JSON.stringify({status:result.status,templates:result.drafts.length,httpWorkflowChecks:result.workflow.length,clientDenied:true,oldContentUnchanged:true,productionWrites:0}))
} finally {await db.end({timeout:2})}
