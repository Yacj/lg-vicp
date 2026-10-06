CREATE TABLE "report_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"project_id" uuid,
	"report_id" uuid,
	"report_type" varchar(80) DEFAULT 'PRODUCT_COMPARISON' NOT NULL,
	"selected_product_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_goal" text,
	"confirmed_requirements_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comparison_context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comparison_result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thermal_results_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversation_states" ADD COLUMN "task_state_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_context_snapshots" ADD CONSTRAINT "report_context_snapshots_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_context_snapshots" ADD CONSTRAINT "report_context_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_context_snapshots" ADD CONSTRAINT "report_context_snapshots_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_context_snapshots" ADD CONSTRAINT "report_context_snapshots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_context_snapshots_conversation_idx" ON "report_context_snapshots" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "report_context_snapshots_project_idx" ON "report_context_snapshots" USING btree ("project_id");