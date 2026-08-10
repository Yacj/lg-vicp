CREATE TYPE "public"."thermal_calc_mode" AS ENUM('REFERENCE_TABLE', 'EQUIVALENT', 'LAYERED');--> statement-breakpoint
CREATE TYPE "public"."thermal_compare_field" AS ENUM('K_VALUE', 'TOTAL_RESISTANCE');--> statement-breakpoint
CREATE TYPE "public"."thermal_compare_operator" AS ENUM('LTE', 'GTE');--> statement-breakpoint
CREATE TYPE "public"."thermal_rounding_mode" AS ENUM('HALF_UP', 'HALF_EVEN', 'TRUNCATE', 'NONE');--> statement-breakpoint
CREATE TABLE "thermal_calc_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(120),
	"mode" "thermal_calc_mode" NOT NULL,
	"project_id" uuid,
	"rule_id" uuid,
	"rule_version" integer,
	"standard_limit_id" uuid,
	"limit_version" integer,
	"input_json" jsonb NOT NULL,
	"layers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parameters_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rule_json" jsonb,
	"standard_json" jsonb,
	"formula_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thermal_calc_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"formula_version" varchar(40) NOT NULL,
	"interior_surface_resistance" numeric(12, 6) NOT NULL,
	"exterior_surface_resistance" numeric(12, 6) NOT NULL,
	"precision" integer DEFAULT 4 NOT NULL,
	"rounding_mode" "thermal_rounding_mode" DEFAULT 'HALF_UP' NOT NULL,
	"compare_field" "thermal_compare_field" DEFAULT 'K_VALUE' NOT NULL,
	"compare_operator" "thermal_compare_operator" DEFAULT 'LTE' NOT NULL,
	"include_non_product_layers" boolean DEFAULT true NOT NULL,
	"include_surface_resistances" boolean DEFAULT true NOT NULL,
	"parameter_codes" jsonb NOT NULL,
	"param_source_priority" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" varchar(40),
	"applicable_scope" text,
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
CREATE TABLE "thermal_standard_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_code" varchar(40) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"region_name" varchar(120) NOT NULL,
	"basis_code" varchar(80) NOT NULL,
	"basis_name" varchar(160) NOT NULL,
	"clause_ref" varchar(120) NOT NULL,
	"limit_k_value" numeric(10, 4) NOT NULL,
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
ALTER TABLE "thermal_calc_records" ADD CONSTRAINT "thermal_calc_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_records" ADD CONSTRAINT "thermal_calc_records_rule_id_thermal_calc_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."thermal_calc_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_records" ADD CONSTRAINT "thermal_calc_records_standard_limit_id_thermal_standard_limits_id_fk" FOREIGN KEY ("standard_limit_id") REFERENCES "public"."thermal_standard_limits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_records" ADD CONSTRAINT "thermal_calc_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_calc_rules" ADD CONSTRAINT "thermal_calc_rules_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_standard_limits" ADD CONSTRAINT "thermal_standard_limits_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thermal_calc_records_mode_created_idx" ON "thermal_calc_records" USING btree ("mode","created_at");--> statement-breakpoint
CREATE INDEX "thermal_calc_records_project_created_idx" ON "thermal_calc_records" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "thermal_calc_records_rule_idx" ON "thermal_calc_records" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "thermal_calc_records_limit_idx" ON "thermal_calc_records" USING btree ("standard_limit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_calc_rules_code_version_unique" ON "thermal_calc_rules" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "thermal_calc_rules_status_updated_idx" ON "thermal_calc_rules" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thermal_standard_limits_region_basis_version_unique" ON "thermal_standard_limits" USING btree ("region_code","basis_code","version");--> statement-breakpoint
CREATE INDEX "thermal_standard_limits_region_status_idx" ON "thermal_standard_limits" USING btree ("region_code","status");--> statement-breakpoint
CREATE INDEX "thermal_standard_limits_status_updated_idx" ON "thermal_standard_limits" USING btree ("status","updated_at");