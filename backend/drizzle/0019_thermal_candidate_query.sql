CREATE TABLE "thermal_candidate_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(120),
	"project_id" uuid,
	"query_json" jsonb NOT NULL,
	"candidate_json" jsonb NOT NULL,
	"selection_reason" text,
	"selected_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD COLUMN "building_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thermal_reference_sets" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "thermal_candidate_selections" ADD CONSTRAINT "thermal_candidate_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_candidate_selections" ADD CONSTRAINT "thermal_candidate_selections_selected_by_id_users_id_fk" FOREIGN KEY ("selected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thermal_candidate_selections_project_created_idx" ON "thermal_candidate_selections" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "thermal_candidate_selections_user_created_idx" ON "thermal_candidate_selections" USING btree ("selected_by_id","created_at");