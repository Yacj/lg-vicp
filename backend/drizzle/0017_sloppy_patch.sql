CREATE TYPE "public"."thermal_import_job_status" AS ENUM('CREATED', 'QUEUED', 'PARSING', 'PARSED', 'APPLIED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."knowledge_file_source" ADD VALUE 'THERMAL_IMPORT';--> statement-breakpoint
CREATE TABLE "thermal_import_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"sheet_name" varchar(120),
	"row_number" integer NOT NULL,
	"raw_row" jsonb,
	"error_type" varchar(60) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_code" varchar(80) NOT NULL,
	"name" varchar(160),
	"set_id" uuid,
	"file_id" uuid NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"status" "thermal_import_job_status" DEFAULT 'CREATED' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"valid_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_summary" text,
	"applied_by_id" uuid,
	"applied_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_reference_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"scheme_id" uuid NOT NULL,
	"product_spec_id" uuid NOT NULL,
	"thickness_mm" numeric(8, 2) NOT NULL,
	"product_thermal_resistance" numeric(10, 4) NOT NULL,
	"total_thermal_resistance" numeric(10, 4) NOT NULL,
	"k_value" numeric(10, 4) NOT NULL,
	"raw_thickness" text NOT NULL,
	"raw_product_resistance" text NOT NULL,
	"raw_total_resistance" text NOT NULL,
	"raw_k_value" text NOT NULL,
	"evidence_source" text NOT NULL,
	"evidence_ref" varchar(120) NOT NULL,
	"evidence_level" "knowledge_evidence_level" DEFAULT 'A' NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_reference_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"atlas_document_id" uuid,
	"change_note" text,
	"evidence_source" text,
	"evidence_ref" varchar(120),
	"evidence_level" "knowledge_evidence_level",
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
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
ALTER TABLE "thermal_import_errors" ADD CONSTRAINT "thermal_import_errors_job_id_thermal_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."thermal_import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_import_jobs" ADD CONSTRAINT "thermal_import_jobs_set_id_thermal_reference_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."thermal_reference_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_import_jobs" ADD CONSTRAINT "thermal_import_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_import_jobs" ADD CONSTRAINT "thermal_import_jobs_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_import_jobs" ADD CONSTRAINT "thermal_import_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_set_id_thermal_reference_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."thermal_reference_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_scheme_id_construction_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."construction_schemes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_product_spec_id_product_specs_id_fk" FOREIGN KEY ("product_spec_id") REFERENCES "public"."product_specs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_atlas_document_id_knowledge_documents_id_fk" FOREIGN KEY ("atlas_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD CONSTRAINT "thermal_reference_sets_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thermal_import_errors_job_idx" ON "thermal_import_errors" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "thermal_import_jobs_set_code_idx" ON "thermal_import_jobs" USING btree ("set_code");--> statement-breakpoint
CREATE INDEX "thermal_import_jobs_file_idx" ON "thermal_import_jobs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "thermal_import_jobs_status_idx" ON "thermal_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_reference_rows_set_scheme_spec_thickness_unique" ON "thermal_reference_rows" USING btree ("set_id","scheme_id","product_spec_id","thickness_mm");--> statement-breakpoint
CREATE INDEX "thermal_reference_rows_scheme_idx" ON "thermal_reference_rows" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "thermal_reference_rows_spec_idx" ON "thermal_reference_rows" USING btree ("product_spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_reference_sets_code_version_unique" ON "thermal_reference_sets" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "thermal_reference_sets_status_updated_idx" ON "thermal_reference_sets" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "thermal_import_jobs" ADD COLUMN "error_message" text;