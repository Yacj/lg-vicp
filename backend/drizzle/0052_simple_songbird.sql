CREATE TYPE "public"."knowledge_index_status" AS ENUM('INDEX_PENDING', 'INDEXING', 'INDEX_READY', 'INDEX_FAILED');--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "index_status" "knowledge_index_status" DEFAULT 'INDEX_PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "index_dirty" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "index_built_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_document_versions" ADD COLUMN "index_revision" integer DEFAULT 0 NOT NULL;