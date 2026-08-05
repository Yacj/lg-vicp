CREATE TYPE "public"."knowledge_chunk_content_type" AS ENUM('PARAGRAPH', 'TITLE', 'SECTION', 'CLAUSE', 'TABLE', 'NOTE', 'FORMULA', 'IMAGE_CAPTION');--> statement-breakpoint
CREATE TYPE "public"."knowledge_doc_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_doc_type" AS ENUM('SPECIFICATION', 'DETAIL_ATLAS', 'STANDARD', 'APPLICATION_GUIDE', 'MATERIAL_COMPARISON', 'COMPANY_PROFILE', 'THERMAL_FORMULA', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."knowledge_evidence_level" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."knowledge_parse_status" AS ENUM('PENDING', 'PARSING', 'PARSED', 'PARTIAL', 'OCR_REQUIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_term_type" AS ENUM('KEYWORD', 'SYNONYM', 'ENTITY', 'CLAUSE_NO');--> statement-breakpoint
CREATE TYPE "public"."knowledge_version_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."parsing_job_status" AS ENUM('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'OCR_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."parsing_job_type" AS ENUM('PARSE', 'REPARSE', 'CHUNK_REBUILD', 'OCR');--> statement-breakpoint
CREATE TABLE "knowledge_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" varchar(255) NOT NULL,
	"alias" varchar(255) NOT NULL,
	"term_type" "knowledge_term_type" DEFAULT 'KEYWORD' NOT NULL,
	"scope" varchar(20) DEFAULT 'GLOBAL' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" varchar(120) NOT NULL,
	"code" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunk_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"term" varchar(255) NOT NULL,
	"term_type" "knowledge_term_type" DEFAULT 'KEYWORD' NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"source_type" "knowledge_doc_type" DEFAULT 'OTHER' NOT NULL,
	"page_number" integer,
	"clause_no" varchar(80),
	"evidence_level" "knowledge_evidence_level",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid,
	"title" varchar(255) NOT NULL,
	"status" "knowledge_version_status" DEFAULT 'DRAFT' NOT NULL,
	"parse_status" "knowledge_parse_status" DEFAULT 'PENDING' NOT NULL,
	"page_count" integer,
	"parser" varchar(80),
	"evidence_level" "knowledge_evidence_level",
	"change_note" text,
	"effective_date" date,
	"expiry_date" date,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"parsed_text" text,
	"page_image_object_key" varchar(512),
	"section_path" varchar(255),
	"has_tables" boolean DEFAULT false NOT NULL,
	"has_images" boolean DEFAULT false NOT NULL,
	"parse_status" "knowledge_parse_status" DEFAULT 'PARSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_search_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"searcher_user_id" uuid,
	"project_id" uuid,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"filters" jsonb,
	"match_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"top_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parsing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"job_type" "parsing_job_type" NOT NULL,
	"status" "parsing_job_status" DEFAULT 'QUEUED' NOT NULL,
	"file_id" uuid,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"queued_by_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_file_id_files_id_fk";
--> statement-breakpoint
DROP INDEX "knowledge_chunks_document_index_unique";--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "parser" SET DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."knowledge_doc_status";--> statement-breakpoint
-- 存量状态回填：'ready' → 'ACTIVE'，必须位于类型转换之前
UPDATE "knowledge_documents" SET "status" = 'ACTIVE' WHERE "status" = 'ready';--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "status" SET DATA TYPE "public"."knowledge_doc_status" USING "status"::"public"."knowledge_doc_status";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "heading_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "content_type" "knowledge_chunk_content_type" DEFAULT 'PARAGRAPH' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "search_text" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "alias_terms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "citation_anchor" varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "sort_weight" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "doc_number" varchar(80);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "doc_type" "knowledge_doc_type" DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "source_org" varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "issue_date" date;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "evidence_level" "knowledge_evidence_level";--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "allowed_purposes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "updated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_aliases" ADD CONSTRAINT "knowledge_aliases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_terms" ADD CONSTRAINT "knowledge_chunk_terms_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_citations" ADD CONSTRAINT "knowledge_citations_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_citations" ADD CONSTRAINT "knowledge_citations_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_citations" ADD CONSTRAINT "knowledge_citations_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_searcher_user_id_users_id_fk" FOREIGN KEY ("searcher_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_jobs" ADD CONSTRAINT "parsing_jobs_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_jobs" ADD CONSTRAINT "parsing_jobs_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_jobs" ADD CONSTRAINT "parsing_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_jobs" ADD CONSTRAINT "parsing_jobs_queued_by_id_users_id_fk" FOREIGN KEY ("queued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_aliases_term_alias_unique" ON "knowledge_aliases" USING btree ("term","alias");--> statement-breakpoint
CREATE INDEX "knowledge_aliases_alias_idx" ON "knowledge_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "knowledge_aliases_enabled_idx" ON "knowledge_aliases" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "knowledge_categories_parent_idx" ON "knowledge_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "knowledge_categories_enabled_sort_idx" ON "knowledge_categories" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunk_terms_chunk_term_unique" ON "knowledge_chunk_terms" USING btree ("chunk_id","term");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_terms_term_idx" ON "knowledge_chunk_terms" USING btree ("term","term_type");--> statement-breakpoint
CREATE INDEX "knowledge_citations_chunk_idx" ON "knowledge_citations" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "knowledge_citations_document_page_idx" ON "knowledge_citations" USING btree ("document_id","version_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_versions_document_version_unique" ON "knowledge_document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_document_status_idx" ON "knowledge_document_versions" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_status_updated_idx" ON "knowledge_document_versions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_document_versions_file_idx" ON "knowledge_document_versions" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_pages_version_page_unique" ON "knowledge_pages" USING btree ("version_id","page_number");--> statement-breakpoint
CREATE INDEX "knowledge_pages_document_version_idx" ON "knowledge_pages" USING btree ("document_id","version_id");--> statement-breakpoint
CREATE INDEX "knowledge_pages_version_section_idx" ON "knowledge_pages" USING btree ("version_id","section_path");--> statement-breakpoint
CREATE INDEX "knowledge_search_logs_user_searched_idx" ON "knowledge_search_logs" USING btree ("searcher_user_id","searched_at");--> statement-breakpoint
CREATE INDEX "knowledge_search_logs_searched_idx" ON "knowledge_search_logs" USING btree ("searched_at");--> statement-breakpoint
CREATE INDEX "parsing_jobs_document_version_status_idx" ON "parsing_jobs" USING btree ("document_id","version_id","status");--> statement-breakpoint
CREATE INDEX "parsing_jobs_status_created_idx" ON "parsing_jobs" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_category_id_knowledge_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."knowledge_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_current_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_version_index_unique" ON "knowledge_chunks" USING btree ("version_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_version_idx" ON "knowledge_chunks" USING btree ("document_id","version_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_version_content_type_idx" ON "knowledge_chunks" USING btree ("version_id","content_type");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_version_section_idx" ON "knowledge_chunks" USING btree ("version_id","source_section");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_keywords_gin_idx" ON "knowledge_chunks" USING gin ("keywords" jsonb_ops);--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_text_trgm_idx" ON "knowledge_chunks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "knowledge_documents_status_category_idx" ON "knowledge_documents" USING btree ("status","category_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_doc_type_status_idx" ON "knowledge_documents" USING btree ("doc_type","status");--> statement-breakpoint
CREATE INDEX "knowledge_documents_deleted_idx" ON "knowledge_documents" USING btree ("deleted_at");
-- ============================================================
-- 存量数据回填（知识库版本化迁移）
-- ============================================================
-- 1. 为存量文档生成 v1 版本：置 PUBLISHED 维持现状可用性（人工确认见 docs/knowledge/README.md）
INSERT INTO "knowledge_document_versions" ("document_id", "version", "file_id", "title", "status", "parse_status", "page_count", "parser", "created_at", "updated_at", "published_at")
SELECT kd."id", kd."version", kd."file_id", kd."title", 'PUBLISHED', 'PARSED', kd."page_count", kd."parser", kd."created_at", kd."updated_at", COALESCE(kd."updated_at", kd."created_at")
FROM "knowledge_documents" kd;
--> statement-breakpoint
-- 2. 回填文档当前受控版本
UPDATE "knowledge_documents" kd
SET "current_version_id" = kdv."id"
FROM "knowledge_document_versions" kdv
WHERE kdv."document_id" = kd."id" AND kdv."version" = kd."version";
--> statement-breakpoint
-- 3. 回填分块所属版本（旧数据每个文档只有一个版本）
UPDATE "knowledge_chunks" kc
SET "version_id" = kdv."id"
FROM "knowledge_document_versions" kdv
WHERE kdv."document_id" = kc."document_id"
  AND kdv."version" = (SELECT kd2."version" FROM "knowledge_documents" kd2 WHERE kd2."id" = kc."document_id");
--> statement-breakpoint
-- 4. 存量分块缺少页面粒度数据，对应版本标记 PARTIAL（可手动重新解析补齐）
UPDATE "knowledge_document_versions" SET "parse_status" = 'PARTIAL'
WHERE "id" IN (SELECT DISTINCT "version_id" FROM "knowledge_chunks" WHERE "version_id" IS NOT NULL);
--> statement-breakpoint
-- 5. 回填完成后强制 NOT NULL
ALTER TABLE "knowledge_chunks" ALTER COLUMN "version_id" SET NOT NULL;