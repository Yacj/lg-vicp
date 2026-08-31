#!/usr/bin/env node
// 知识原文导航历史升级：只投递存在明确缺口、且没有运行中升级任务的版本。
// 不读取 OSS、不执行全量 OCR；Worker 仍按单版本逐份升级。
// 用法：pnpm backfill:knowledge-wiki -- --dry-run [--limit 50]
import "dotenv/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import postgres from "postgres";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const requestedLimit = Number(args[limitIndex + 1] ?? 100);
const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const info = (message) => console.log(`[知识升级] ${message}`);

function missingItems(row) {
  const items = [];
  if (Number(row.section_count) === 0) items.push("Section");
  if (Number(row.block_count) === 0) items.push("Block");
  if (Number(row.chunk_count) === 0) items.push("Chunk");
  if (Number(row.page_count) > 0 && Number(row.preview_count) < Number(row.page_count) && row.original_mime_type === "application/pdf") items.push("页面预览");
  if (row.parse_status === "NO_TEXT_LAYER" && Number(row.mapping_count) === 0) items.push("页面映射");
  return items;
}

async function main() {
  const candidates = await sql`
    select v.id as version_id, v.document_id, v.version, v.status, v.parse_status, v.file_id,
           count(distinct p.id)::int as page_count,
           count(distinct s.id)::int as section_count,
           count(distinct b.id)::int as block_count,
           count(distinct c.id)::int as chunk_count,
           count(distinct m.id)::int as mapping_count,
           count(distinct p.id) filter (where p.page_image_object_key is not null)::int as preview_count,
           f.mime_type as original_mime_type,
           exists (
             select 1 from knowledge_document_assets a
             where a.version_id = v.id and a.role = 'SEARCH_SOURCE'
           ) as has_search_source
    from knowledge_document_versions v
    join knowledge_pages p on p.version_id = v.id
    left join knowledge_sections s on s.version_id = v.id
    left join knowledge_page_blocks b on b.version_id = v.id
    left join knowledge_chunks c on c.version_id = v.id
    left join knowledge_page_mappings m on m.version_id = v.id
    left join files f on f.id = v.file_id
    where v.status <> 'DISABLED'
      and not exists (
        select 1 from parsing_jobs j
        where j.version_id = v.id
          and j.job_type = 'UPGRADE_PARSE'
          and j.status in ('QUEUED', 'ACTIVE')
      )
    group by v.id, v.document_id, v.version, v.status, v.parse_status, v.file_id, f.mime_type
    having count(distinct s.id) = 0
       or count(distinct b.id) = 0
       or count(distinct c.id) = 0
       or (v.parse_status = 'NO_TEXT_LAYER' and count(distinct m.id) = 0)
       or (f.mime_type = 'application/pdf' and count(distinct p.id) filter (where p.page_image_object_key is not null) < count(distinct p.id))
    order by v.document_id, v.version
    limit ${limit}
  `;

  info(`候选版本：${candidates.length}${dryRun ? "（dry-run，不投递）" : ""}`);
  for (const row of candidates) {
    const missing = missingItems(row).join("、");
    const mode = row.parse_status === "NO_TEXT_LAYER"
      ? row.has_search_source ? "双源" : "浏览版待补检索源"
      : "单源";
    info(`版本 ${row.version_id}（v${row.version}，${mode}，缺少：${missing || "未知派生项"}）`);
  }
  if (dryRun || candidates.length === 0) {
    await sql.end();
    return;
  }

  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 3000
  });
  const queue = new Queue("document-processing", { connection });
  try {
    for (const row of candidates) {
      // 条件插入避免脚本并发执行时重复投递；保留真实 ORIGINAL file_id 供 Worker 读取。
      const jobs = await sql`
        insert into parsing_jobs (document_id, version_id, job_type, status, file_id, progress, attempts, created_at, updated_at)
        select ${row.document_id}, ${row.version_id}, 'UPGRADE_PARSE', 'QUEUED', ${row.file_id}, 0, 0, now(), now()
        where not exists (
          select 1 from parsing_jobs
          where version_id = ${row.version_id}
            and job_type = 'UPGRADE_PARSE'
            and status in ('QUEUED', 'ACTIVE')
        )
        returning id
      `;
      const job = jobs[0];
      if (!job) {
        info(`跳过版本 ${row.version_id}：已有运行中的升级任务`);
        continue;
      }
      await queue.add("parse_document", {
        parsingJobId: job.id,
        fileId: row.file_id ?? "",
        versionId: row.version_id,
        jobType: "UPGRADE_PARSE"
      }, { jobId: job.id });
      info(`已投递：版本 ${row.version_id} → parsing_job ${job.id}`);
    }
  } finally {
    await queue.close();
    await connection.quit();
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[知识升级] 执行失败：", error);
  process.exitCode = 1;
});
