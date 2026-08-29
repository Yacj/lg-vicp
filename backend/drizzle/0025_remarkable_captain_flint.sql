CREATE TYPE "public"."knowledge_doc_visibility" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TABLE "knowledge_page_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"section_id" uuid,
	"block_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_type" "knowledge_chunk_content_type" DEFAULT 'PARAGRAPH' NOT NULL,
	"search_text" text,
	"source_anchor" varchar(255),
	"start_offset" integer,
	"end_offset" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"parent_id" uuid,
	"section_key" varchar(500) NOT NULL,
	"title" varchar(255) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_page" integer,
	"end_page" integer,
	"search_text" text,
	"source_anchor" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "page_block_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "insulation_system_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "visibility" "knowledge_doc_visibility" DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_page_blocks" ADD CONSTRAINT "knowledge_page_blocks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_blocks" ADD CONSTRAINT "knowledge_page_blocks_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_blocks" ADD CONSTRAINT "knowledge_page_blocks_page_id_knowledge_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."knowledge_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page_blocks" ADD CONSTRAINT "knowledge_page_blocks_section_id_knowledge_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sections" ADD CONSTRAINT "knowledge_sections_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sections" ADD CONSTRAINT "knowledge_sections_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sections" ADD CONSTRAINT "knowledge_sections_parent_id_knowledge_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_page_blocks_page_index_unique" ON "knowledge_page_blocks" USING btree ("page_id","block_index");--> statement-breakpoint
CREATE INDEX "knowledge_page_blocks_version_section_idx" ON "knowledge_page_blocks" USING btree ("version_id","section_id");--> statement-breakpoint
CREATE INDEX "knowledge_page_blocks_document_page_idx" ON "knowledge_page_blocks" USING btree ("document_id","page_id");--> statement-breakpoint
CREATE INDEX "knowledge_page_blocks_search_text_trgm_idx" ON "knowledge_page_blocks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sections_version_key_unique" ON "knowledge_sections" USING btree ("version_id","section_key");--> statement-breakpoint
CREATE INDEX "knowledge_sections_document_version_idx" ON "knowledge_sections" USING btree ("document_id","version_id");--> statement-breakpoint
CREATE INDEX "knowledge_sections_parent_sort_idx" ON "knowledge_sections" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "knowledge_sections_title_idx" ON "knowledge_sections" USING btree ("title");--> statement-breakpoint
CREATE INDEX "knowledge_sections_search_text_trgm_idx" ON "knowledge_sections" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_section_id_knowledge_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_page_block_id_knowledge_page_blocks_id_fk" FOREIGN KEY ("page_block_id") REFERENCES "public"."knowledge_page_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_insulation_system_id_insulation_systems_id_fk" FOREIGN KEY ("insulation_system_id") REFERENCES "public"."insulation_systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_section_id_knowledge_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_version_section_id_idx" ON "knowledge_chunks" USING btree ("version_id","section_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_version_page_block_idx" ON "knowledge_chunks" USING btree ("version_id","page_block_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_visibility_status_idx" ON "knowledge_documents" USING btree ("visibility","status");--> statement-breakpoint
CREATE INDEX "knowledge_documents_insulation_system_idx" ON "knowledge_documents" USING btree ("insulation_system_id");--> statement-breakpoint
CREATE INDEX "knowledge_pages_version_section_id_idx" ON "knowledge_pages" USING btree ("version_id","section_id");