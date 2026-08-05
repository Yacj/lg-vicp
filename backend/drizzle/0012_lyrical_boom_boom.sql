CREATE TYPE "public"."knowledge_evaluation_judgement" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."knowledge_file_source" AS ENUM('USER_UPLOAD', 'BATCH_IMPORT', 'CRAWLER', 'INTERNAL_API');--> statement-breakpoint
CREATE TYPE "public"."knowledge_pipeline_status" AS ENUM('UPLOAD_PENDING', 'UPLOADED', 'PARSING', 'CHUNKING', 'REVIEW_PENDING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TABLE "knowledge_crawler_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"base_url" text NOT NULL,
	"download_url_pattern" text NOT NULL,
	"doc_type" "knowledge_doc_type" DEFAULT 'STANDARD' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_ranking_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_ranking_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_search_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"parsed_keywords" jsonb,
	"expected_document_id" uuid,
	"expected_page" integer,
	"actual_top_results" jsonb,
	"judgement" "knowledge_evaluation_judgement" DEFAULT 'PENDING' NOT NULL,
	"judged_by_id" uuid,
	"judged_at" timestamp with time zone,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "source" "knowledge_file_source" DEFAULT 'USER_UPLOAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "pipeline_status" "knowledge_pipeline_status" DEFAULT 'UPLOAD_PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "region" varchar(80);--> statement-breakpoint
ALTER TABLE "knowledge_crawler_sources" ADD CONSTRAINT "knowledge_crawler_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_evaluations" ADD CONSTRAINT "knowledge_search_evaluations_expected_document_id_knowledge_documents_id_fk" FOREIGN KEY ("expected_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_evaluations" ADD CONSTRAINT "knowledge_search_evaluations_judged_by_id_users_id_fk" FOREIGN KEY ("judged_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_evaluations" ADD CONSTRAINT "knowledge_search_evaluations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_crawler_sources_enabled_idx" ON "knowledge_crawler_sources" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "knowledge_search_evaluations_judgement_idx" ON "knowledge_search_evaluations" USING btree ("judgement","judged_at");--> statement-breakpoint
CREATE INDEX "files_sha256_idx" ON "files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_pipeline_idx" ON "knowledge_document_versions" USING btree ("pipeline_status","updated_at");
-- ============================================================
-- 存量版本处理管线状态回填
-- ============================================================
-- 已发布版本 → PUBLISHED
UPDATE "knowledge_document_versions" SET "pipeline_status" = 'PUBLISHED' WHERE "status" = 'PUBLISHED';
-- 解析失败版本 → FAILED
UPDATE "knowledge_document_versions" SET "pipeline_status" = 'FAILED' WHERE "parse_status" = 'FAILED';
-- 已有解析结果的草稿/待审核/已停用版本 → REVIEW_PENDING（待人工审核或重新发布）
UPDATE "knowledge_document_versions" SET "pipeline_status" = 'REVIEW_PENDING'
WHERE "pipeline_status" = 'UPLOAD_PENDING'
  AND "status" IN ('DRAFT', 'APPROVED', 'PENDING_REVIEW', 'DISABLED')
  AND "parse_status" IN ('PARSED', 'PARTIAL', 'OCR_REQUIRED');
-- 其余无文件/未解析草稿保持 UPLOAD_PENDING