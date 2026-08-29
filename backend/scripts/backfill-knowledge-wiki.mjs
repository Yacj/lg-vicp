#!/usr/bin/env node
// ============================================================
// 知识库 Wiki 层级回填脚本：
//
// - 背景：Wiki 化改造前解析的历史版本只有 knowledge_pages（可能含旧 chunks），
//   缺少 knowledge_sections / knowledge_page_blocks 层级结构；
// - 策略：对「有页面但无章节」的版本逐个投递 CHUNK_REBUILD 解析任务，
//   Worker 复用 writeParsedContent 从页面原文重建 章节 → 内容块 → 兼容 Chunk；
// - 安全性：不读 OSS、不改页面原文；已发布版本重建只重写派生内容，不降级管线状态；
// - 幂等性：重复执行会自动跳过已有章节的版本；不强制一次重跑全部历史资料。
//
// 用法：
//   pnpm backfill:knowledge-wiki -- --dry-run        # 只打印待回填版本清单
//   pnpm backfill:knowledge-wiki -- --limit 50       # 每批最多回填 50 个版本（默认 100）
// ============================================================
import "dotenv/config";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import postgres from "postgres";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 100) : 100;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const info = (msg) => console.log(`[Wiki回填] ${msg}`);

async function main() {
  const candidates = await sql`
    select v.id as version_id, v.document_id, v.status, v.version,
           count(p.id)::int as page_count
    from knowledge_document_versions v
    join knowledge_pages p on p.version_id = v.id
    left join knowledge_sections s on s.version_id = v.id
    where s.id is null
    group by v.id, v.document_id, v.status, v.version
    order by v.document_id, v.version
    limit ${Number.isFinite(limit) && limit > 0 ? limit : 100}
  `;

  info(`待回填版本数：${candidates.length}${dryRun ? "（dry-run，不投递任务）" : ""}`);
  for (const row of candidates) {
    info(`  版本 ${row.version_id}（文档 ${row.document_id} v${row.version}，状态 ${row.status}，页数 ${row.page_count}）`);
  }
  if (dryRun || candidates.length === 0) {
    await sql.end();
    return;
  }

  // 与 src/plugins/redis.ts 相同的连接参数，保证与 Worker 同一 Redis 约定
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 3000
  });
  const queue = new Queue("document-processing", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 }
    }
  });

  for (const row of candidates) {
    const [job] = await sql`
      insert into parsing_jobs
        (document_id, version_id, job_type, status, file_id, progress, attempts, created_at, updated_at)
      values
        (${row.document_id}, ${row.version_id}, 'CHUNK_REBUILD', 'QUEUED', null, 0, 0, now(), now())
      returning id
    `;
    await queue.add("parse_document", {
      parsingJobId: job.id,
      fileId: "",
      versionId: row.version_id,
      jobType: "CHUNK_REBUILD"
    }, { jobId: job.id });
    info(`已投递回填任务：版本 ${row.version_id} → parsing_job ${job.id}`);
  }

  await queue.close();
  await connection.quit();
  await sql.end();
  info("回填任务投递完成，由 document-processing Worker 执行");
}

main().catch((error) => {
  console.error("[Wiki回填] 执行失败：", error);
  process.exitCode = 1;
});
