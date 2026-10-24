import 'dotenv/config'
import postgres from 'postgres'
import Redis from 'ioredis'
import { readdir,readFile,writeFile } from 'node:fs/promises'
const root='docs/ai/evidence/natural-dialogue-repair-2026-10-20'
const environments=[]
for(const dir of await readdir(root,{withFileTypes:true}))if(dir.isDirectory()){
 try{environments.push(JSON.parse(await readFile(`${root}/${dir.name}/environment.json`,'utf8')))}catch{}
}
if(!environments.every(e=>/^vicp_h5_uat_[0-9a-f]{32}$/.test(e.databaseName)&&/^vicp-h5-uat-[0-9a-f]{32}$/.test(e.prefix)))throw Error('Unexpected scope')
const sql=postgres(process.env.DATABASE_URL,{max:1,onnotice:()=>{},connection:{options:'-c default_transaction_read_only=on -c statement_timeout=15000'}})
const redis=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1})
try{
 const remainingDatabases=await sql`select datname from pg_database where datname=any(${environments.map(e=>e.databaseName)})`
 const remainingKeys=[]
 for(const e of environments){let cursor='0';do{const [next,keys]=await redis.scan(cursor,'MATCH',`${e.prefix}*`,'COUNT',1000);cursor=next;remainingKeys.push(...keys)}while(cursor!=='0')}
 const result={checkedEnvironments:environments.length,remainingDatabases,remainingKeys,readOnlyVerification:true}
 await writeFile(`${root}/cleanup-independent-check.json`,JSON.stringify(result,null,2))
 if(remainingDatabases.length||remainingKeys.length)throw Error('Isolated resources remain')
 console.log(JSON.stringify({checkedEnvironments:environments.length,remainingDatabases:0,remainingKeys:0}))
}finally{await sql.end();await redis.quit()}
