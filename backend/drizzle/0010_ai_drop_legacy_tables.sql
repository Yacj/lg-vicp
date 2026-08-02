-- 数据迁移：ai_scene_bindings → ai_scenes（一期仅 general_chat 开放，其余场景默认关闭）
INSERT INTO "ai_scenes" ("name", "code", "description", "default_model_id", "fallback_model_id", "allow_reasoning", "require_project", "allow_file_upload", "allow_knowledge_search", "allow_tools", "temperature", "max_output_tokens", "enabled", "sort")
SELECT
  CASE b."scene"
    WHEN 'general_chat' THEN '通用对话'
    WHEN 'project_design' THEN '项目设计'
    WHEN 'material_compare' THEN '材料对比'
    WHEN 'standard_qa' THEN '标准问答'
    WHEN 'report_generate' THEN '报告生成'
    WHEN 'information_extract' THEN '信息抽取'
    ELSE b."scene"
  END,
  b."scene",
  NULL,
  b."primary_model_id",
  b."fallback_model_id",
  b."scene" = 'general_chat',
  FALSE,
  FALSE,
  FALSE,
  FALSE,
  CAST(b."settings" ->> 'temperature' AS real),
  CAST(b."settings" ->> 'maxOutputTokens' AS integer),
  b."scene" = 'general_chat',
  CASE b."scene"
    WHEN 'general_chat' THEN 1
    WHEN 'project_design' THEN 2
    WHEN 'material_compare' THEN 3
    WHEN 'standard_qa' THEN 4
    WHEN 'report_generate' THEN 5
    WHEN 'information_extract' THEN 6
    ELSE 99
  END
FROM "ai_scene_bindings" b;
--> statement-breakpoint
-- 数据迁移：prompt_templates → prompts + prompt_versions（每个场景 1 条 prompt + 1 个 PUBLISHED v1）
INSERT INTO "prompts" ("scene_id", "name", "code", "description")
SELECT s."id", t."name", s."code", NULL
FROM "prompt_templates" t
JOIN "ai_scenes" s ON s."code" = t."scene";
--> statement-breakpoint
INSERT INTO "prompt_versions" ("prompt_id", "version", "content", "status", "change_note", "published_at", "created_at")
SELECT p."id", 1, t."system_prompt", 'PUBLISHED', '初始版本（由 prompt_templates 迁移）', t."created_at", t."created_at"
FROM "prompt_templates" t
JOIN "ai_scenes" s ON s."code" = t."scene"
JOIN "prompts" p ON p."scene_id" = s."id";
--> statement-breakpoint
UPDATE "prompts" SET "active_version_id" = v."id"
FROM "prompt_versions" v
WHERE v."prompt_id" = "prompts"."id" AND v."status" = 'PUBLISHED';
--> statement-breakpoint
UPDATE "ai_scenes" SET "prompt_id" = p."id"
FROM "prompts" p
WHERE p."scene_id" = "ai_scenes"."id";
--> statement-breakpoint
DROP TABLE "ai_scene_bindings" CASCADE;
--> statement-breakpoint
DROP TABLE "prompt_templates" CASCADE;