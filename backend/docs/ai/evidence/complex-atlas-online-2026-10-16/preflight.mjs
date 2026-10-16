import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import ssh2 from 'ssh2';
const config=dotenv.parse(fs.readFileSync('deploy/.env.deploy'));
const local=dotenv.parse(fs.readFileSync('.env'));
const remoteDir=config.DEPLOY_REMOTE_DIR;
if(!remoteDir||!remoteDir.startsWith('/www/wwwroot/'))throw Error('部署目录需要核验');
const q=s=>`'${s.replaceAll("'",`'"'"'`)}'`;
const conn=new ssh2.Client();
const key=config.DEPLOY_SSH_KEY||path.join(os.homedir(),'.ssh/id_rsa');
await new Promise((resolve,reject)=>{conn.on('ready',resolve).on('error',reject).connect({host:config.DEPLOY_SSH_HOST,port:Number(config.DEPLOY_SSH_PORT||22),username:config.DEPLOY_SSH_USER||'root',readyTimeout:15000,...(config.DEPLOY_SSH_PASSWORD?{password:config.DEPLOY_SSH_PASSWORD}:{privateKey:fs.readFileSync(key)})});});
const code=`import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import dotenv from 'dotenv';import postgres from 'postgres';
const env=dotenv.parse(fs.readFileSync('.env'));const result={cwd:process.cwd(),node:process.version,provider:env.STORAGE_PROVIDER,envHash:createHash('sha256').update(fs.readFileSync('.env')).digest('hex')};
let processes=[];try{processes=JSON.parse(execFileSync('/www/server/nodejs/v22.22.3/bin/pm2',['jlist'],{encoding:'utf8',maxBuffer:8000000}));}catch{}result.processes=processes.map(p=>({name:p.name,status:p.pm2_env?.status,cwd:p.pm2_env?.pm_cwd,script:p.pm2_env?.pm_exec_path}));
const {Redis}=await import('ioredis');const redis=new Redis(env.REDIS_URL,{maxRetriesPerRequest:1,connectTimeout:5000});redis.on('error',()=>{});result.activeJobs={};try{for(const queue of ['page-recognition','document-processing','report-generation','thermal-import','collection-fetch'])result.activeJobs[queue]=await redis.llen('bull:'+queue+':active');}finally{redis.disconnect();}
result.sites=fs.readdirSync('/www/wwwroot',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>({name:d.name,index:fs.existsSync('/www/wwwroot/'+d.name+'/index.html'),package:fs.existsSync('/www/wwwroot/'+d.name+'/package.json')}));
if(process.argv.includes('--logs')){}
const db=postgres(env.DATABASE_URL,{max:1,connect_timeout:5,connection:{options:'-c default_transaction_read_only=on'}});try{result.readOnly=(await db\`show transaction_read_only\`)[0].transaction_read_only;result.documents=await db\`select d.id,d.title,d.status,d.current_version_id,v.id as version_id,v.version,v.status as version_status,count(p.id)::int as pages from knowledge_documents d left join knowledge_document_versions v on v.document_id=d.id left join knowledge_pages p on p.version_id=v.id where d.deleted_at is null group by d.id,v.id order by d.created_at\`;result.pages=await db\`select id,document_id,version_id,page_label,physical_page_number,page_title,metadata->>'recognitionStatus' as status from knowledge_pages where page_label in ('75','89','90') order by page_label\`;}finally{await db.end();}
for(const file of ['dist/modules/ai/confirmed-page-fact-verify.js','dist/shared/page-recognition.js'])result[file]=fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
console.log(JSON.stringify(result));`;
try{const command=`cd ${q(remoteDir)} && /www/server/nodejs/v22.22.3/bin/node --input-type=module -e ${q(code)}`;const output=await new Promise((resolve,reject)=>{conn.exec(command,(error,stream)=>{if(error)return reject(error);let out='',err='';stream.on('data',b=>out+=b);stream.stderr.on('data',b=>err+=b);stream.on('close',exit=>exit===0?resolve(out):reject(Error('远端只读预检失败：'+err.replace(/postgres(?:ql)?:\/\/\S+/g,'[DB]'))));});});const report=JSON.parse(output);const out=process.argv.includes('--after')?'after':'preflight';fs.writeFileSync('docs/ai/evidence/complex-atlas-online-2026-10-16/'+out+'.json',output);console.log(JSON.stringify({processes:report.processes,activeJobs:report.activeJobs,provider:report.provider,envHash:report.envHash,documents:report.documents,pages:report.pages}));}finally{conn.end();}
