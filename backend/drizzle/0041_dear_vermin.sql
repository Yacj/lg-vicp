CREATE TYPE "public"."ai_agent_run_type" AS ENUM('CHAT', 'COLLECTION');--> statement-breakpoint
CREATE TYPE "public"."catalog_product_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."project_visibility" ADD VALUE 'DEPARTMENT';--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"category_id" uuid,
	"summary" text,
	"status" "catalog_product_status" DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"skill_id" uuid,
	"task_id" uuid,
	"run_id" uuid,
	"title" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"keywords_json" jsonb,
	"summary" text,
	"raw_data_json" jsonb,
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"skill_id" uuid,
	"task_id" uuid,
	"run_type" "ai_agent_run_type" DEFAULT 'COLLECTION' NOT NULL,
	"status" "collection_run_status" DEFAULT 'RUNNING' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"max_steps" integer DEFAULT 12 NOT NULL,
	"max_pages" integer DEFAULT 8 NOT NULL,
	"visited_urls_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stored_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_by_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"keywords_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instruction" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_knowledge_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"knowledge_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "admin_login_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD COLUMN "run_type" "ai_agent_run_type" DEFAULT 'CHAT' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_sources" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_sources" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "visible_department_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "include_child_departments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_source_id_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."collection_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_skill_id_collection_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."collection_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_records" ADD CONSTRAINT "collection_records_run_id_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_source_id_collection_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."collection_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_skill_id_collection_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."collection_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_task_id_collection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collection_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_skills" ADD CONSTRAINT "collection_skills_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_knowledge_links" ADD CONSTRAINT "product_knowledge_links_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_knowledge_links" ADD CONSTRAINT "product_knowledge_links_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_products_status_sort_idx" ON "catalog_products" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "catalog_products_name_idx" ON "catalog_products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_records_fingerprint_unique" ON "collection_records" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "collection_records_collected_idx" ON "collection_records" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "collection_records_source_collected_idx" ON "collection_records" USING btree ("source_id","collected_at");--> statement-breakpoint
CREATE INDEX "collection_records_url_idx" ON "collection_records" USING btree ("url");--> statement-breakpoint
CREATE INDEX "collection_runs_source_started_idx" ON "collection_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "collection_runs_status_idx" ON "collection_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "collection_skills_enabled_idx" ON "collection_skills" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "collection_skills_updated_idx" ON "collection_skills" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_knowledge_links_unique" ON "product_knowledge_links" USING btree ("product_id","knowledge_document_id");--> statement-breakpoint
CREATE INDEX "product_knowledge_links_document_idx" ON "product_knowledge_links" USING btree ("knowledge_document_id");--> statement-breakpoint
ALTER TABLE "collection_sources" ADD CONSTRAINT "collection_sources_skill_id_collection_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."collection_skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_visible_department_id_departments_id_fk" FOREIGN KEY ("visible_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_sources_skill_idx" ON "collection_sources" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "projects_visible_department_idx" ON "projects" USING btree ("visible_department_id","visibility");