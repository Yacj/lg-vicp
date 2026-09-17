CREATE TYPE "public"."collection_mode" AS ENUM('MANUAL', 'AUTO');--> statement-breakpoint
CREATE TYPE "public"."collection_task_status" AS ENUM('PENDING', 'RUNNING', 'WAITING_CONFIRM', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_fact_status" AS ENUM('DRAFT', 'VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_fact_type" AS ENUM('MATERIAL', 'PRODUCT_SPEC', 'CONSTRUCTION', 'THERMAL_PARAMETER', 'STANDARD_LIMIT', 'NODE_REFERENCE');--> statement-breakpoint
ALTER TYPE "public"."knowledge_file_source" ADD VALUE 'COLLECTION';--> statement-breakpoint
CREATE TABLE "collection_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"source_url" text NOT NULL,
	"mode" "collection_mode" DEFAULT 'AUTO' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_collected_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"name" varchar(160) NOT NULL,
	"source_url" text NOT NULL,
	"mode" "collection_mode" NOT NULL,
	"status" "collection_task_status" DEFAULT 'PENDING' NOT NULL,
	"result_file_id" uuid,
	"result_meta" jsonb,
	"error_message" text,
	"created_by_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"imported_knowledge_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_type" "knowledge_fact_type" NOT NULL,
	"subject" varchar(255) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_document_id" uuid NOT NULL,
	"source_version_id" uuid,
	"source_section_id" uuid,
	"source_page_label" varchar(80),
	"source_physical_page_number" integer,
	"status" "knowledge_fact_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_sources" ADD CONSTRAINT "collection_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_source_id_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."collection_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_result_file_id_files_id_fk" FOREIGN KEY ("result_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_imported_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("imported_knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_source_document_id_knowledge_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_source_version_id_knowledge_document_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_source_section_id_knowledge_sections_id_fk" FOREIGN KEY ("source_section_id") REFERENCES "public"."knowledge_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_sources_enabled_idx" ON "collection_sources" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "collection_sources_updated_idx" ON "collection_sources" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "collection_tasks_status_created_idx" ON "collection_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "collection_tasks_mode_status_idx" ON "collection_tasks" USING btree ("mode","status");--> statement-breakpoint
CREATE INDEX "collection_tasks_source_idx" ON "collection_tasks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "knowledge_facts_type_subject_status_idx" ON "knowledge_facts" USING btree ("fact_type","subject","status");--> statement-breakpoint
CREATE INDEX "knowledge_facts_source_document_idx" ON "knowledge_facts" USING btree ("source_document_id","status");