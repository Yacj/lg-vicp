CREATE TYPE "public"."construction_layer_type" AS ENUM('BASE_LAYER', 'PRODUCT_LAYER', 'FIXING_LAYER', 'VARIABLE_LAYER');--> statement-breakpoint
CREATE TYPE "public"."scheme_document_target_type" AS ENUM('SYSTEM', 'SCHEME');--> statement-breakpoint
CREATE TABLE "construction_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"layer_order" integer NOT NULL,
	"layer_type" "construction_layer_type" NOT NULL,
	"layer_name" varchar(120) NOT NULL,
	"material_id" uuid,
	"thickness" numeric(8, 2),
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
CREATE TABLE "construction_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"scheme_code" varchar(40) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"substrate_material" varchar(120) NOT NULL,
	"substrate_thickness" numeric(8, 2),
	"drawing_file_id" uuid,
	"atlas_page" varchar(40),
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
CREATE TABLE "insulation_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"system_type" varchar(80) NOT NULL,
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
CREATE TABLE "scheme_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "scheme_document_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"knowledge_document_id" uuid,
	"atlas_page" varchar(40),
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
CREATE TABLE "scheme_product_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheme_id" uuid NOT NULL,
	"product_spec_id" uuid NOT NULL,
	"min_thickness" numeric(8, 2) NOT NULL,
	"max_thickness" numeric(8, 2) NOT NULL,
	"default_thickness" numeric(8, 2),
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
ALTER TABLE "construction_layers" ADD CONSTRAINT "construction_layers_scheme_id_construction_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."construction_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_layers" ADD CONSTRAINT "construction_layers_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_layers" ADD CONSTRAINT "construction_layers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_layers" ADD CONSTRAINT "construction_layers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_system_id_insulation_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."insulation_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_drawing_file_id_files_id_fk" FOREIGN KEY ("drawing_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_schemes" ADD CONSTRAINT "construction_schemes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_rejected_by_id_users_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insulation_systems" ADD CONSTRAINT "insulation_systems_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_documents" ADD CONSTRAINT "scheme_documents_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_documents" ADD CONSTRAINT "scheme_documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_documents" ADD CONSTRAINT "scheme_documents_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_product_options" ADD CONSTRAINT "scheme_product_options_scheme_id_construction_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."construction_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_product_options" ADD CONSTRAINT "scheme_product_options_product_spec_id_product_specs_id_fk" FOREIGN KEY ("product_spec_id") REFERENCES "public"."product_specs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_product_options" ADD CONSTRAINT "scheme_product_options_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_product_options" ADD CONSTRAINT "scheme_product_options_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "construction_layers_scheme_order_unique" ON "construction_layers" USING btree ("scheme_id","layer_order");--> statement-breakpoint
CREATE UNIQUE INDEX "construction_layers_product_unique" ON "construction_layers" USING btree ("scheme_id") WHERE "construction_layers"."layer_type" = 'PRODUCT_LAYER';--> statement-breakpoint
CREATE UNIQUE INDEX "construction_layers_base_unique" ON "construction_layers" USING btree ("scheme_id") WHERE "construction_layers"."layer_type" = 'BASE_LAYER';--> statement-breakpoint
CREATE UNIQUE INDEX "construction_schemes_system_code_version_unique" ON "construction_schemes" USING btree ("system_id","scheme_code","version");--> statement-breakpoint
CREATE INDEX "construction_schemes_system_status_idx" ON "construction_schemes" USING btree ("system_id","status");--> statement-breakpoint
CREATE INDEX "construction_schemes_status_updated_idx" ON "construction_schemes" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insulation_systems_code_version_unique" ON "insulation_systems" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "insulation_systems_status_updated_idx" ON "insulation_systems" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheme_documents_target_document_unique" ON "scheme_documents" USING btree ("target_type","target_id","knowledge_document_id");--> statement-breakpoint
CREATE INDEX "scheme_documents_document_idx" ON "scheme_documents" USING btree ("knowledge_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheme_product_options_scheme_spec_unique" ON "scheme_product_options" USING btree ("scheme_id","product_spec_id");--> statement-breakpoint
CREATE INDEX "scheme_product_options_spec_idx" ON "scheme_product_options" USING btree ("product_spec_id");