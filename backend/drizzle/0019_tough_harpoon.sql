CREATE TYPE "public"."standard_crawl_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."standard_crawl_trigger" AS ENUM('SCHEDULE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."standard_document_status" AS ENUM('DRAFT_CONSULTATION', 'OFFICIAL', 'SUPERSEDED', 'REPEALED');--> statement-breakpoint
CREATE TYPE "public"."standard_indicator_type" AS ENUM('K_VALUE', 'HEAT_RESISTANCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."standard_ingest_type" AS ENUM('CRAWL', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."standard_parse_status" AS ENUM('PENDING', 'PARSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."standard_replacement_status" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."standard_replacement_type" AS ENUM('SUPERSEDE', 'REPEAL');--> statement-breakpoint
CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "standard_crawl_status" DEFAULT 'QUEUED' NOT NULL,
	"triggered_by" "standard_crawl_trigger" NOT NULL,
	"scope" varchar(20) DEFAULT 'today' NOT NULL,
	"catalog_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats_json" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_applicability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"region_code" varchar(40) NOT NULL,
	"region_name" varchar(120) NOT NULL,
	"building_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structure_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_text" text,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"evidence_ref" varchar(120),
	"status" "md_review_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_by_id" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "standard_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_type" "standard_ingest_type" NOT NULL,
	"province_code" varchar(40) NOT NULL,
	"province_name" varchar(120) NOT NULL,
	"source_id" uuid,
	"crawl_job_id" uuid,
	"document_no" varchar(120) NOT NULL,
	"title" varchar(300) NOT NULL,
	"category" varchar(80),
	"standard_status" "standard_document_status" DEFAULT 'OFFICIAL' NOT NULL,
	"publish_date" date,
	"implement_date" date,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"origin_url" text,
	"page_html_object_key" varchar(500),
	"page_html_sha256" varchar(64),
	"file_object_key" varchar(500),
	"file_sha256" varchar(64),
	"file_size" bigint,
	"screenshot_object_key" varchar(500),
	"parsed_meta_json" jsonb,
	"parse_status" "standard_parse_status" DEFAULT 'PENDING' NOT NULL,
	"superseded_by_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "md_review_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_by_id" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"applicability_id" uuid,
	"indicator_type" "standard_indicator_type" DEFAULT 'K_VALUE' NOT NULL,
	"indicator_name" varchar(120) NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"unit" varchar(40),
	"raw_text" text,
	"evidence_ref" varchar(120),
	"evidence_level" "knowledge_evidence_level",
	"screenshot_object_key" varchar(500),
	"status" "md_review_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_replacements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"old_document_id" uuid NOT NULL,
	"new_document_id" uuid NOT NULL,
	"replacement_type" "standard_replacement_type" DEFAULT 'SUPERSEDE' NOT NULL,
	"transition_start_at" timestamp with time zone,
	"transition_end_at" timestamp with time zone,
	"status" "standard_replacement_status" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"confirmed_by_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standard_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province_code" varchar(40) NOT NULL,
	"province_name" varchar(120) NOT NULL,
	"official_domain" varchar(255) NOT NULL,
	"catalog_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parser_type" varchar(40) DEFAULT 'generic-list' NOT NULL,
	"extract_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"crawl_scope" varchar(20) DEFAULT 'today' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD COLUMN "standard_document_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_source_id_standard_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."standard_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_document_id_standard_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."standard_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD CONSTRAINT "standard_applicability_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_source_id_standard_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."standard_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_crawl_job_id_crawl_jobs_id_fk" FOREIGN KEY ("crawl_job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_documents" ADD CONSTRAINT "standard_documents_superseded_by_id_standard_documents_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."standard_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_indicators" ADD CONSTRAINT "standard_indicators_document_id_standard_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."standard_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_indicators" ADD CONSTRAINT "standard_indicators_applicability_id_standard_applicability_id_fk" FOREIGN KEY ("applicability_id") REFERENCES "public"."standard_applicability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_indicators" ADD CONSTRAINT "standard_indicators_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_replacements" ADD CONSTRAINT "standard_replacements_old_document_id_standard_documents_id_fk" FOREIGN KEY ("old_document_id") REFERENCES "public"."standard_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_replacements" ADD CONSTRAINT "standard_replacements_new_document_id_standard_documents_id_fk" FOREIGN KEY ("new_document_id") REFERENCES "public"."standard_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_replacements" ADD CONSTRAINT "standard_replacements_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_jobs_source_status_idx" ON "crawl_jobs" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "crawl_jobs_status_created_idx" ON "crawl_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_applicability_document_region_unique" ON "standard_applicability" USING btree ("document_id","region_code");--> statement-breakpoint
CREATE INDEX "standard_applicability_region_status_idx" ON "standard_applicability" USING btree ("region_code","status");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_documents_province_no_version_unique" ON "standard_documents" USING btree ("province_code","document_no","version");--> statement-breakpoint
CREATE INDEX "standard_documents_document_no_idx" ON "standard_documents" USING btree ("document_no");--> statement-breakpoint
CREATE INDEX "standard_documents_status_idx" ON "standard_documents" USING btree ("standard_status");--> statement-breakpoint
CREATE INDEX "standard_documents_review_status_idx" ON "standard_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "standard_documents_publish_date_idx" ON "standard_documents" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "standard_documents_ingest_type_idx" ON "standard_documents" USING btree ("ingest_type");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_indicators_doc_app_type_version_unique" ON "standard_indicators" USING btree ("document_id","applicability_id","indicator_type","version");--> statement-breakpoint
CREATE INDEX "standard_indicators_status_updated_idx" ON "standard_indicators" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_replacements_old_new_unique" ON "standard_replacements" USING btree ("old_document_id","new_document_id");--> statement-breakpoint
CREATE INDEX "standard_replacements_status_idx" ON "standard_replacements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_sources_province_domain_unique" ON "standard_sources" USING btree ("province_code","official_domain");--> statement-breakpoint
CREATE INDEX "standard_sources_enabled_idx" ON "standard_sources" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_standard_document_id_standard_documents_id_fk" FOREIGN KEY ("standard_document_id") REFERENCES "public"."standard_documents"("id") ON DELETE set null ON UPDATE no action;