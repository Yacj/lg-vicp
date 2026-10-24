import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const out=process.argv[2]
const fixture=JSON.parse(await readFile('tests/fixtures/confirmed-source-page-labels.json','utf8'))
const documentId='baedb3e4-0935-4322-94e1-a02e4d4178ad'
const credentials=JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-final-uat-private-login.json','utf8'))
const auth=await(await fetch('http://127.0.0.1:3329/api/v1/auth/client/login/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,clientType:'C_APP'})})).json()
assert.equal(auth.success,true)
const result={at:new Date().toISOString(),scope:'真实C端身份HTTP读取来源详情、印刷页标签与物理页，不写资料',checks:[]}
let publicAccess = true
async function get(path){const response=await fetch(`http://127.0.0.1:3329/api/v1${path}`,{headers:{Authorization:`Bearer ${auth.data.accessToken}`}});return {http:response.status,...await response.json()}}
for(const [physical,label] of [[3,null],[5,'25'],[6,'26'],[33,'53']]){
  const original=fixture.pages.find(page=>page.physicalPageNumber===physical)
  const detail=await get(`/ai/knowledge/source-detail?pageId=${original.pageId}`)
  assert.equal(detail.success,true);assert.equal(detail.data.location.pageLabel,label);assert.equal(detail.data.page.pageLabel,label)
  assert.equal(detail.data.location.physicalPageNumber,physical)
  result.checks.push({kind:'SOURCE_DETAIL',physical,printed:label,http:detail.http,success:true})
  const byPhysical=await get(`/client/knowledge/documents/${documentId}/pages/${physical}`)
  if(!byPhysical.success){assert.equal(byPhysical.error?.code,404);publicAccess=false
    result.checks.push({kind:'PUBLIC_BROWSE_DENIED',physical,http:byPhysical.http,success:false,errorCode:byPhysical.error?.code})
  } else {assert.equal(byPhysical.data.page.id,original.pageId);assert.equal(byPhysical.data.page.pageLabel,label)
    result.checks.push({kind:'PHYSICAL_PAGE',physical,printed:label,http:byPhysical.http,success:true})}
  if(label&&publicAccess){const byLabel=await get(`/client/knowledge/documents/${documentId}/pages/by-label/${label}`)
    assert.equal(byLabel.success,true);assert.equal(byLabel.data.page.id,original.pageId);assert.equal(byLabel.data.page.physicalPageNumber,physical)
    result.checks.push({kind:'PRINTED_LABEL',physical,printed:label,http:byLabel.http,success:true})}
}
for(const old of ['3','5','6']){const response=await get(`/client/knowledge/documents/${documentId}/pages/by-label/${old}`);assert.equal(response.success,false)
  result.checks.push({kind:'OLD_PHYSICAL_LABEL_REJECTED',requested:old,http:response.http,success:false,errorCode:response.error?.code})}
result.status=publicAccess?'PASS':'PARTIAL';result.sourceDetailStatus='PASS';result.publicNavigation=publicAccess?'PASS':'NOT_RUN_POSITIVE: 当前来源文档不是PUBLIC，公开文库按权限返回404；未修改可见性。已验证source-detail四页真实标签，PUBLIC导航正向和歧义/指纹失效由单元用例覆盖。';await writeFile(`${out}/page-label-http-verification.json`,JSON.stringify(result,null,2))
console.log(JSON.stringify({status:result.status,checks:result.checks.length}))
