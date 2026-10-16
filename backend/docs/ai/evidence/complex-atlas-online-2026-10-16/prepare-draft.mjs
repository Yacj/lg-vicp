/** 用户授权的线上业务入库：仅新增三页DRAFT与真实识别任务，不确认、不发布、不覆盖旧数据。 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';
const out='docs/ai/evidence/complex-atlas-online-2026-10-16';
const stateFile=path.join(out,'draft-state.json');
if(!process.argv.includes('--apply'))throw Error('必须显式--apply执行已授权的线上草稿入库');
const session=JSON.parse(fs.readFileSync(path.join(process.env.TEMP,'atlas-online-session.json'),'utf8'));
if(session.base!=='https://lgapi.zblack.cn'||session.user?.clientType!=='B_ADMIN')throw Error('线上B端身份不符');
const config=dotenv.parse(fs.readFileSync('.env'));
const db=postgres(config.DATABASE_URL,{max:1,connect_timeout:5,connection:{options:'-c default_transaction_read_only=on'}});
const inputs=[['89','C:/Users/zjj/AppData/Local/Temp/codex-clipboard-337dcafe-07cf-42cd-a23e-a0375e9b8e89.png','建筑屋面热工计算参考选用表（I型VICP屋面保温系统）'],['90','C:/Users/zjj/AppData/Local/Temp/codex-clipboard-31f00e56-e9bb-4214-b18e-fa01f152823e.png','建筑屋面热工计算参考选用表（II型VICP屋面保温系统）'],['75','C:/Users/zjj/AppData/Local/Temp/codex-clipboard-6c64e27d-c83e-4451-bf3c-3b76d729356f.png','建筑外墙热工计算参考选用表（I型VICP复合保温装饰板保温系统）']];
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{status:'PREPARING',pages:[],createdAt:new Date().toISOString()};
const checkpoint=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
async function api(route,body,method=body===undefined?'GET':'POST'){
 const res=await fetch(session.base+route,{method,headers:{Authorization:'Bearer '+session.accessToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const result=await res.json(); if(!result.success)throw Error('正式API拒绝 '+route+': '+(result.error?.message||res.status));return result.data;
}
try {
 if(!fs.existsSync(path.join(out,'old-record-hashes-before.json'))){
   const snapshot={pages:await db`select id,md5(row_to_json(p)::text) as hash from knowledge_pages p order by id`,thermalRows:await db`select id,md5(row_to_json(t)::text) as hash from thermal_reference_rows t order by id`,reports:await db`select id,md5(row_to_json(r)::text) as hash from reports r order by id`};
   fs.writeFileSync(path.join(out,'old-record-hashes-before.json'),JSON.stringify(snapshot,null,2));
 }
 if(!state.documentId){
   const created=await api('/api/v1/platform/knowledge/documents',{title:'建筑热工计算参考选用表（J/CABEE 26J702）',docType:'DETAIL_ATLAS',docNumber:'J/CABEE 26J702'});
   state.documentId=created.documentId;state.versionId=created.versionId;checkpoint();
 }
 for(const [index,[label,file,title]] of inputs.entries()){
   let item=state.pages.find(p=>p.label===label);
   if(!item){item={label,title,physicalPageNumber:index+1};state.pages.push(item);checkpoint();}
   if(!item.fileId){
     const bytes=fs.readFileSync(file);const sha256=createHash('sha256').update(bytes).digest('hex');
     const expected=JSON.parse(fs.readFileSync('tests/fixtures/complex-atlas/page-'+label+'.json','utf8')).imageSha256;
     if(sha256!==expected)throw Error('原图身份不符，停止上传');
     const intent=await api('/api/v1/files/upload-intents',{purpose:'KNOWLEDGE_SOURCE',fileName:'26J702-印刷页'+label+'.png',mimeType:'image/png',sizeBytes:bytes.length,sha256});
     if(intent.mode!=='REUSE'){
       const url=new URL(intent.uploadUrl);if(!url.hostname.endsWith('.aliyuncs.com'))throw Error('上传目标不是已授权OSS');url.protocol='https:';
       const response=await fetch(url,{method:'PUT',headers:intent.headers,body:bytes,signal:AbortSignal.timeout(60000)});
       if(!response.ok)throw Error('OSS上传失败，HTTP '+response.status);
       const completed=await api('/api/v1/files/'+intent.fileId+'/complete',{});item.fileId=completed.duplicateOfFileId||completed.fileId||intent.fileId;
     }else item.fileId=intent.fileId;
     item.imageSha256=sha256;checkpoint();
   }
   if(!item.pageId){const created=await api('/api/v1/platform/knowledge/versions/'+state.versionId+'/pages',{pageNumber:item.physicalPageNumber,pageLabel:label,pageTitle:title,imageFileId:item.fileId});item.pageId=created.page.id;checkpoint();}
   if(!item.recognitionQueued){
     const detail=await api('/api/v1/platform/knowledge/pages/'+item.pageId+'/recognition');
     if(detail.versionStatus!=='DRAFT')throw Error('只允许操作本次新DRAFT');
     if(!['PENDING','PROCESSING','REVIEW_REQUIRED'].includes(detail.recognitionStatus))await api('/api/v1/platform/knowledge/pages/'+item.pageId+'/recognize',{});
     item.recognitionQueued=true;checkpoint();console.log('印刷页'+label+'：已通过正式API上传原件并提交真实Worker识别');
   }
 }
 state.status='RECOGNITION_QUEUED';state.reviewUrl='https://lgadmin.zblack.cn/knowledge/documents/'+state.documentId;checkpoint();console.log(JSON.stringify({documentId:state.documentId,versionId:state.versionId,pages:state.pages.map(p=>({label:p.label,pageId:p.pageId})),reviewUrl:state.reviewUrl}));
}catch(error){state.error={name:error.name,message:error.message};checkpoint();throw error;}finally{await db.end();}
