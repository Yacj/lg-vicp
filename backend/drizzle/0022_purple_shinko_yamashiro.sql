CREATE TYPE "public"."professional_review_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."report_status" ADD VALUE 'PENDING_REVIEW';--> statement-breakpoint
ALTER TYPE "public"."report_status" ADD VALUE 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."report_status" ADD VALUE 'REJECTED';--> statement-breakpoint
CREATE TABLE "node_drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"position" varchar(80) NOT NULL,
	"system_id" uuid,
	"atlas_page" varchar(40),
	"image_file_id" uuid,
	"cad_file_id" uuid,
	"description" text,
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
CREATE TABLE "node_scheme_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_drawing_id" uuid NOT NULL,
	"scheme_id" uuid NOT NULL,
	"atlas_page" varchar(40),
	"remark" text,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"evidence_source" text,
	"evidence_ref" varchar(120),
	"evidence_level" "knowledge_evidence_level",
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer,
	"status" "professional_review_status" NOT NULL,
	"comment" text,
	"project_id" uuid,
	"submitted_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"request_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"as_of_date" timestamp with time zone,
	"data_json" jsonb NOT NULL,
	"generated_by_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"sections_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
ALTER TABLE "reports" ADD COLUMN "submitted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "rejected_by_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_system_id_insulation_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."insulation_systems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_cad_file_id_files_id_fk" FOREIGN KEY ("cad_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_drawings" ADD CONSTRAINT "node_drawings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_scheme_links" ADD CONSTRAINT "node_scheme_links_node_drawing_id_node_drawings_id_fk" FOREIGN KEY ("node_drawing_id") REFERENCES "public"."node_drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_scheme_links" ADD CONSTRAINT "node_scheme_links_scheme_id_construction_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."construction_schemes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_scheme_links" ADD CONSTRAINT "node_scheme_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_scheme_links" ADD CONSTRAINT "node_scheme_links_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_reviews" ADD CONSTRAINT "professional_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_reviews" ADD CONSTRAINT "professional_reviews_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_reviews" ADD CONSTRAINT "professional_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_generated_by_id_users_id_fk" FOREIGN KEY ("generated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "node_drawings_code_version_unique" ON "node_drawings" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "node_drawings_system_position_idx" ON "node_drawings" USING btree ("system_id","position");--> statement-breakpoint
CREATE INDEX "node_drawings_position_idx" ON "node_drawings" USING btree ("position");--> statement-breakpoint
CREATE INDEX "node_drawings_status_updated_idx" ON "node_drawings" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_scheme_links_drawing_scheme_unique" ON "node_scheme_links" USING btree ("node_drawing_id","scheme_id");--> statement-breakpoint
CREATE INDEX "node_scheme_links_scheme_idx" ON "node_scheme_links" USING btree ("scheme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_reviews_entity_unique" ON "professional_reviews" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "professional_reviews_status_idx" ON "professional_reviews" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_snapshots_report_unique" ON "report_snapshots" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_code_version_unique" ON "report_templates" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "report_templates_status_updated_idx" ON "report_templates" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;