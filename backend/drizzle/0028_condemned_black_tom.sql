CREATE TYPE "public"."knowledge_asset_role" AS ENUM('ORIGINAL', 'SEARCH_SOURCE', 'OCR_SOURCE', 'PREVIEW');--> statement-breakpoint
CREATE TYPE "public"."knowledge_page_mapping_method" AS ENUM('PAGE_LABEL', 'TOC_TITLE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."knowledge_toc_source" AS ENUM('PDF_BOOKMARK', 'TOC_PAGE', 'MANUAL', 'COMPANION_FILE');--> statement-breakpoint
CREATE TYPE "public"."knowledge_toc_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_usage_mode" AS ENUM('AI_ENABLED', 'BROWSE_ONLY');--> statement-breakpoint
ALTER TYPE "public"."knowledge_parse_status" ADD VALUE 'NO_TEXT_LAYER';--> statement-breakpoint
ALTER TYPE "public"."knowledge_parse_status" ADD VALUE 'SEARCH_SOURCE_REQUIRED';--> statement-breakpoint
ALTER TYPE "public"."parsing_job_type" ADD VALUE 'UPGRADE_PARSE';--> statement-breakpoint
CREATE TABLE "knowledge_document_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"role" "knowledge_asset_role" NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_page_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"original_page_id" uuid NOT NULL,
	"search_physical_page_number" integer NOT NULL,
	"page_label" varchar(32),
	"mapping_method" "knowledge_page_mapping_method" DEFAULT 'PAGE_LABEL' NOT NULL,
	"confidence" real,
	"verified" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_toc_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" varchar(255) NOT NULL,
	"page_label" varchar(32),
	"physical_page_number" integer,
	"source" "knowledge_toc_source" DEFAULT 'MANUAL' NOT NULL,
	"confidence" real,
	"section_id" uuid,
	"status" "knowledge_toc_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "usage_mode" "knowledge_usage_mode" DEFAULT 'AI_ENABLED' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "physical_page_number" integer;--> statement-breakpoint
UPDATE "knowledge_pages" SET "physical_page_number" = "page_number" WHERE "physical_page_number" IS NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ALTER COLUMN "physical_page_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "page_label" varchar(32);--> statement-breakpoint
UPDATE "knowledge_pages" SET "page_label" = "page_number"::text WHERE "page_label" IS NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "page_title" varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_document_assets" ADD CONSTRAINT "knowledge_document_assets_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_assets" ADD CONSTRAINT "knowledge_document_assets_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_assets" ADD CONSTRAINT "knowledge_document_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_assets" ADD CONSTRAINT "knowledge_document_assets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_mappings" ADD CONSTRAINT "knowledge_page_mappings_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_mappings" ADD CONSTRAINT "knowledge_page_mappings_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_mappings" ADD CONSTRAINT "knowledge_page_mappings_original_page_id_knowledge_pages_id_fk" FOREIGN KEY ("original_page_id") REFERENCES "public"."knowledge_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_mappings" ADD CONSTRAINT "knowledge_page_mappings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_toc_items" ADD CONSTRAINT "knowledge_toc_items_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_toc_items" ADD CONSTRAINT "knowledge_toc_items_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_toc_items" ADD CONSTRAINT "knowledge_toc_items_section_id_knowledge_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_toc_items" ADD CONSTRAINT "knowledge_toc_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_toc_items" ADD CONSTRAINT "knowledge_toc_items_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_assets_version_role_unique" ON "knowledge_document_assets" USING btree ("version_id","role");--> statement-breakpoint
CREATE INDEX "knowledge_document_assets_document_idx" ON "knowledge_document_assets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "knowledge_document_assets_file_idx" ON "knowledge_document_assets" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_page_mappings_version_search_page_unique" ON "knowledge_page_mappings" USING btree ("version_id","search_physical_page_number");--> statement-breakpoint
CREATE INDEX "knowledge_page_mappings_version_original_idx" ON "knowledge_page_mappings" USING btree ("version_id","original_page_id");--> statement-breakpoint
CREATE INDEX "knowledge_toc_items_version_sort_idx" ON "knowledge_toc_items" USING btree ("version_id","sort_order");--> statement-breakpoint
CREATE INDEX "knowledge_toc_items_version_parent_idx" ON "knowledge_toc_items" USING btree ("version_id","parent_id");--> statement-breakpoint
CREATE INDEX "knowledge_toc_items_document_idx" ON "knowledge_toc_items" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_pages_version_physical_unique" ON "knowledge_pages" USING btree ("version_id","physical_page_number");--> statement-breakpoint
CREATE INDEX "knowledge_pages_version_label_idx" ON "knowledge_pages" USING btree ("version_id","page_label");--> statement-breakpoint
-- 历史 fileId 兼容回填：视为 ORIGINAL + SEARCH_SOURCE 同一文件（幂等）
INSERT INTO "knowledge_document_assets" ("document_id", "version_id", "file_id", "role", "is_primary")
SELECT v."document_id", v."id", v."file_id", 'ORIGINAL', true
FROM "knowledge_document_versions" v
WHERE v."file_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "knowledge_document_assets" a WHERE a."version_id" = v."id" AND a."role" = 'ORIGINAL');--> statement-breakpoint
INSERT INTO "knowledge_document_assets" ("document_id", "version_id", "file_id", "role", "is_primary")
SELECT v."document_id", v."id", v."file_id", 'SEARCH_SOURCE', true
FROM "knowledge_document_versions" v
WHERE v."file_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "knowledge_document_assets" a WHERE a."version_id" = v."id" AND a."role" = 'SEARCH_SOURCE');