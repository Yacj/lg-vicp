CREATE TYPE "public"."comparison_benchmark_type" AS ENUM('SAME_THICKNESS', 'SAME_LAMBDA', 'SAME_R_VALUE', 'PERFORMANCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."comparison_evidence_side" AS ENUM('VICP', 'COMPETITOR');--> statement-breakpoint
CREATE TYPE "public"."comparison_material_category" AS ENUM('VICP', 'EPS', 'XPS', 'ROCK_WOOL', 'PU', 'TRADITIONAL_BOARD');--> statement-breakpoint
CREATE TABLE "ai_rule_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"rule_id" uuid NOT NULL,
	"rule_code" varchar(80) NOT NULL,
	"version_id" uuid,
	"rule_version" integer NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(80) NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" varchar(255),
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"rule_id" uuid,
	"material_id" uuid,
	"side" "comparison_evidence_side" NOT NULL,
	"source" varchar(255) NOT NULL,
	"page_ref" varchar(120),
	"clause_ref" varchar(120),
	"evidence_level" "knowledge_evidence_level" NOT NULL,
	"quote" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"category" "comparison_material_category" NOT NULL,
	"name" varchar(160) NOT NULL,
	"model" varchar(120) NOT NULL,
	"density" numeric(10, 2),
	"density_unit" varchar(40),
	"test_conditions" text,
	"description" text,
	"evidence_source" text,
	"evidence_ref" varchar(120),
	"evidence_level" "knowledge_evidence_level",
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"dimension_name" varchar(80) NOT NULL,
	"sub_indicator_name" varchar(120),
	"vicp_material_id" uuid NOT NULL,
	"competitor_material_id" uuid NOT NULL,
	"benchmark_type" "comparison_benchmark_type" NOT NULL,
	"benchmark_desc" varchar(255) NOT NULL,
	"vicp_value" numeric(12, 4) NOT NULL,
	"vicp_unit" varchar(40) NOT NULL,
	"competitor_value" numeric(12, 4),
	"competitor_unit" varchar(40),
	"advantage_text" text NOT NULL,
	"applicability" text NOT NULL,
	"mandatory_disclosure" text NOT NULL,
	"forbidden_wording" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
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
ALTER TABLE "ai_rule_usage_logs" ADD CONSTRAINT "ai_rule_usage_logs_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_usage_logs" ADD CONSTRAINT "ai_rule_usage_logs_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_usage_logs" ADD CONSTRAINT "ai_rule_usage_logs_rule_id_comparison_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."comparison_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_rule_usage_logs" ADD CONSTRAINT "ai_rule_usage_logs_version_id_comparison_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."comparison_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_dimensions" ADD CONSTRAINT "comparison_dimensions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_dimensions" ADD CONSTRAINT "comparison_dimensions_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_evidence" ADD CONSTRAINT "comparison_evidence_version_id_comparison_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."comparison_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_evidence" ADD CONSTRAINT "comparison_evidence_rule_id_comparison_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."comparison_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_evidence" ADD CONSTRAINT "comparison_evidence_material_id_comparison_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."comparison_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_evidence" ADD CONSTRAINT "comparison_evidence_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_materials" ADD CONSTRAINT "comparison_materials_version_id_comparison_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."comparison_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_materials" ADD CONSTRAINT "comparison_materials_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_materials" ADD CONSTRAINT "comparison_materials_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_version_id_comparison_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."comparison_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_dimension_id_comparison_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."comparison_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_vicp_material_id_comparison_materials_id_fk" FOREIGN KEY ("vicp_material_id") REFERENCES "public"."comparison_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_competitor_material_id_comparison_materials_id_fk" FOREIGN KEY ("competitor_material_id") REFERENCES "public"."comparison_materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_rules" ADD CONSTRAINT "comparison_rules_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_versions" ADD CONSTRAINT "comparison_versions_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_rule_usage_logs_message_idx" ON "ai_rule_usage_logs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ai_rule_usage_logs_rule_created_idx" ON "ai_rule_usage_logs" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_dimensions_code_unique" ON "comparison_dimensions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "comparison_dimensions_parent_idx" ON "comparison_dimensions" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comparison_evidence_version_idx" ON "comparison_evidence" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "comparison_evidence_rule_idx" ON "comparison_evidence" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "comparison_evidence_material_idx" ON "comparison_evidence" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_materials_version_category_name_model_unique" ON "comparison_materials" USING btree ("version_id","category","name","model");--> statement-breakpoint
CREATE INDEX "comparison_materials_version_idx" ON "comparison_materials" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "comparison_materials_category_idx" ON "comparison_materials" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_rules_version_dimension_materials_benchmark_unique" ON "comparison_rules" USING btree ("version_id","dimension_id","vicp_material_id","competitor_material_id","benchmark_type");--> statement-breakpoint
CREATE INDEX "comparison_rules_version_idx" ON "comparison_rules" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "comparison_rules_dimension_idx" ON "comparison_rules" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX "comparison_rules_vicp_material_idx" ON "comparison_rules" USING btree ("vicp_material_id");--> statement-breakpoint
CREATE INDEX "comparison_rules_competitor_material_idx" ON "comparison_rules" USING btree ("competitor_material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_versions_code_version_unique" ON "comparison_versions" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "comparison_versions_status_updated_idx" ON "comparison_versions" USING btree ("status","updated_at");