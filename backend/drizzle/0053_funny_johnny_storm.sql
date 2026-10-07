ALTER TABLE "knowledge_document_versions" ADD COLUMN "content_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 历史兼容回填（P1-7）：
-- 0052 引入 index_status/index_dirty 时对所有历史行使用默认值 INDEX_PENDING + index_dirty=true，
-- 使升级前已发布的版本变成「PUBLISHED + INDEX_PENDING + dirty=true」；而 rebuild 仅允许 DRAFT/APPROVED，
-- 于是形成无法恢复的死状态。
-- 这里对「已发布 + 已有正式 chunk + 不存在孤儿 page-aware chunk」的版本回填索引就绪；
-- index_revision 与 content_revision 同时对齐（发布门禁要求 indexRevision === contentRevision）。
-- 其余已发布版本保留 INDEX_PENDING，由「内部维护式重建索引」（maintenance rebuild，仅后台维护调用）恢复，
-- 不开放普通编辑，PUBLISHED 正文/页面内容仍然不可变。
UPDATE "knowledge_document_versions" v
SET index_status = 'INDEX_READY',
    index_dirty = false,
    index_built_at = COALESCE(v.index_built_at, now()),
    index_revision = v.content_revision,
    updated_at = now()
WHERE v.status = 'PUBLISHED'
  AND v.index_status = 'INDEX_PENDING'
  AND EXISTS (
    SELECT 1 FROM "knowledge_chunks" c WHERE c.version_id = v.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "knowledge_chunks" c
    WHERE c.version_id = v.id
      AND c.metadata->>'pageAware' = 'true'
      AND NOT EXISTS (
        SELECT 1 FROM "knowledge_pages" p WHERE p.id::text = c.metadata->>'pageId'
      )
  );
