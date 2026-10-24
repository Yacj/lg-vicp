import 'dotenv/config'
import postgres from 'postgres'
import { readFile, writeFile } from 'node:fs/promises'
const out=process.argv[2]
const environment=JSON.parse(await readFile(`${out}/environment.json`,'utf8'))
if(!/^vicp_h5_uat_[0-9a-f]{32}$/.test(environment.databaseName))throw Error('Not an isolated UAT database')
const url=new URL(process.env.DATABASE_URL);url.pathname=`/${environment.databaseName}`
const sql=postgres(url.href,{max:1,onnotice:()=>{},connection:{options:'-c default_transaction_read_only=on -c statement_timeout=15000'}})
try {
 const sections=await sql`select s.title,s.start_page,s.end_page from knowledge_sections s join knowledge_documents d on d.id=s.document_id and d.current_version_id=s.version_id join knowledge_document_versions v on v.id=s.version_id where d.deleted_at is null and d.status='ACTIVE' and v.status='PUBLISHED' and v.usage_mode='AI_ENABLED' and d.project_id is null order by s.sort_order`
 const types=await sql`select c.content_type,count(*)::int from knowledge_chunks c join knowledge_documents d on d.id=c.document_id and d.current_version_id=c.version_id join knowledge_document_versions v on v.id=c.version_id where d.deleted_at is null and d.status='ACTIVE' and v.status='PUBLISHED' and v.usage_mode='AI_ENABLED' and d.project_id is null and c.invalid=false group by c.content_type`
 const paragraphs=await sql`select c.id,c.source_page,c.source_section,c.content_type,c.content from knowledge_chunks c join knowledge_documents d on d.id=c.document_id and d.current_version_id=c.version_id join knowledge_document_versions v on v.id=c.version_id where d.deleted_at is null and d.status='ACTIVE' and v.status='PUBLISHED' and v.usage_mode='AI_ENABLED' and d.project_id is null and c.invalid=false and c.content_type<>'TABLE' order by c.chunk_index`
 await writeFile(`${out}/knowledge-scope-audit.json`,JSON.stringify({scope:'隔离库只读；当前发布全局资料；仅审阅类型与文本，不据关键词决定业务路由或证明事实缺失',sections,types,paragraphs},null,2))
 console.log(JSON.stringify({sections:sections.length,types,nonTableChunks:paragraphs.length,sectionTitles:sections.map(s=>s.title),samples:paragraphs.slice(0,5).map(p=>({page:p.source_page,content:p.content.slice(0,500)}))}))
}finally{await sql.end()}
