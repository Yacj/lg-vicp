"""从冻结交接启动器创建本轮独立副本；不改写历史证据或应用配置。"""
from pathlib import Path
import hashlib
import json
import shutil
import tempfile

ROOT = Path('D:/work/lg-vicp')
PACKAGE = Path('C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接')
OUT = ROOT / 'backend/docs/ai/evidence/phase04-retest-2026-10-19'
RUN = OUT / 'h5-run-02'
RUN.mkdir(parents=True, exist_ok=False)
source = PACKAGE / 'harness/server.mts'
code = source.read_text(encoding='utf-8-sig')

def change(old, new):
    global code
    assert old in code, old[:90]
    code = code.replace(old, new)

change("const root = 'E:/code/lg/backend'", "const root = 'D:/work/lg-vicp/backend'")
change('const directory="C:/Users/zjj/.codex/visualizations/2026/10/18/01a14edd-17c2-78a0-af86-45497e9162ab/phase02-h5"',
       f'const directory={json.dumps(RUN.as_posix())}\nconst privateLogin={json.dumps((Path(tempfile.gettempdir()) / "vicp-phase04-private-login.json").as_posix())}')
change("account:'152****4975'", "account:'隔离专用用户'")
change("'users','user_identities','user_app_access',", "'users',")
change("where id=${'7353aee7-d631-4b29-83a1-1f2b03a6ba4b'} and deleted_at is null and status='ACTIVE'", "where deleted_at is null and status='ACTIVE' limit 1")
change("dataset.set(table,rows);evidence.tables[table]=rows.length", "if(table==='users')for(const row of rows){row.phone=null;row.email=null;row.display_name='隔离资料归属代理';row.avatar_file_id=null;row.admin_login_enabled=false;row.role='NORMAL_USER'}\n      dataset.set(table,rows);evidence.tables[table]=rows.length")
change("await writeFile(`${directory}/.private-login.json`", "await writeFile(privateLogin")
change("state_json from solution_states", "payload from solution_states")
change("status,solution_snapshot_id from reports", "status,content_json from reports")
change("const browser='C:/Program Files/Google/Chrome/Application/chrome.exe'", "const browser='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'")
change("port:3300", "port:3319")
change("evidence.accountCopied=true;", "evidence.accountCopied='身份字段已脱敏；未复制认证凭据';")
change("retryStrategy:()=>null,connectTimeout:5000", "retryStrategy:(attempt:number)=>attempt<4?1000:null,keepAlive:10000,connectTimeout:5000")
change("for(const item of deferred)await client.unsafe(`update \"${item.table}\" set \"${item.column}\"=$1 where id=$2`,[item.value,item.id])", "const deferredGroups=new Map<string,any[]>();for(const item of deferred){assert(/^[a-f0-9-]{36}$/i.test(item.id)&&/^[a-f0-9-]{36}$/i.test(item.value));const key=item.table+'.'+item.column;if(!deferredGroups.has(key))deferredGroups.set(key,[]);deferredGroups.get(key)!.push({id:item.id,value:item.value})};for(const [key,items]of deferredGroups){const [table,column]=key.split('.');await client.unsafe(`update \"${table}\" t set \"${column}\"=v.value from jsonb_to_recordset($1::jsonb) as v(id uuid,value uuid) where t.id=v.id`,[JSON.stringify(items)])}")
change("await app.register(require('@fastify/cors')", "app.addHook('onError',async(_request:any,_reply:any,error:any)=>{evidence.failures.push({kind:'HTTP_ERROR',code:error.code??error.name,cause:error.cause?.code,constraint:error.constraint_name??error.cause?.constraint_name});await saveEvidence()})\n  await app.register(require('@fastify/cors')")
change("'standard_replacements','report_templates'", "'standard_replacements','comparison_versions','comparison_materials','comparison_dimensions','comparison_rules','comparison_evidence','report_templates'")
change("evidence.engineeringJsonCopiedExactly=true", "evidence.engineeringJsonCopiedExactly=true\n  evidence.sourceDataFingerprint=Object.fromEntries([...dataset].filter(([table])=>!['users','ai_providers','ai_models','prompts','prompt_versions'].includes(table)).map(([table,rows])=>[table,{count:rows.length,sha256:require('node:crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex')}]))")
change("const chunks:Buffer[]=[];const raw=reply.raw;const write=raw.write.bind(raw);const end=raw.end.bind(raw)", "const chunks:Buffer[]=[];const raw=reply.raw;const write=raw.write.bind(raw);const end=raw.end.bind(raw);let observedContentType:any;const writeHead=raw.writeHead.bind(raw);raw.writeHead=(status:any,...args:any[])=>{for(const arg of args)if(arg&&typeof arg==='object')observedContentType=arg['Content-Type']??arg['content-type']??observedContentType;return writeHead(status,...args)}")
change("contentType:raw.getHeader('content-type')", "contentType:observedContentType??raw.getHeader('content-type')")
change("evidence.setupError={code:error.code??error.name,message:", "evidence.setupError={code:error.code??error.name,message:")
change("console.log(JSON.stringify({ready:true", "evidence.transport='真实HTTP/SSE与Edge浏览器；无模型Mock';await saveEvidence();console.log(JSON.stringify({ready:true")
# 仅记录真实上游请求数量/状态，禁止保存授权头、请求体或模型思维链。
change("let client,app,redis", "const upstream:any[]=[]\nconst nativeFetch=globalThis.fetch\nglobalThis.fetch=async(input:any,init:any)=>{let url:any;try{url=new URL(typeof input==='string'?input:input.url??String(input))}catch{};const tracked=url&&!['localhost','127.0.0.1'].includes(url.hostname);const entry:any={at:new Date().toISOString(),method:init?.method??'GET',path:url?.pathname};if(tracked)upstream.push(entry);try{const response=await nativeFetch(input,init);if(tracked){entry.status=response.status;await writeFile(`${directory}/upstream-requests.json`,JSON.stringify(upstream,null,2))}return response}catch(error){if(tracked){entry.error=error.name;await writeFile(`${directory}/upstream-requests.json`,JSON.stringify(upstream,null,2))}throw error}}\nlet client,app,redis")
(RUN / 'server.mts').write_text(code, encoding='utf-8')
(RUN / 'launcher-provenance.json').write_text(json.dumps({
    'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'adaptations': ['本机路径与空闲loopback端口', '独立证据目录和临时凭据文件', '未复制源用户认证凭据，归属代理去个人信息',
                    '保持工程JSON原样；记录源数据指纹', '观察器读取payload并记录SSE Content-Type', '已安装Edge与真实上游请求计数'],
    'sourceModified': False,
}, ensure_ascii=False, indent=2), encoding='utf-8')
shadow = Path(tempfile.gettempdir()) / 'vicp-phase04-h5-app'
if not shadow.exists():
    shutil.copytree(ROOT / 'app', shadow, ignore=shutil.ignore_patterns('node_modules', 'dist', '.git', '.audit', 'unpackage'))
(OUT / 'local-runtime.json').write_text(json.dumps({'shadowApp':str(shadow),'api':'http://127.0.0.1:3319','h5':'http://127.0.0.1:8879','browser':'Edge'}, indent=2), encoding='utf-8')
print(json.dumps({'prepared':str(RUN),'shadowApp':str(shadow)}, ensure_ascii=False))
