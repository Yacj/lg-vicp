CREATE TABLE "solution_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solution_state_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solution_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"stage" varchar(40) DEFAULT 'COLLECTING_REQUIREMENTS' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"candidate_set_revision" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"confirmed_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "solution_snapshots" ADD CONSTRAINT "solution_snapshots_solution_state_id_solution_states_id_fk" FOREIGN KEY ("solution_state_id") REFERENCES "public"."solution_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_snapshots" ADD CONSTRAINT "solution_snapshots_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_snapshots" ADD CONSTRAINT "solution_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_snapshots" ADD CONSTRAINT "solution_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_snapshots" ADD CONSTRAINT "solution_snapshots_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_states" ADD CONSTRAINT "solution_states_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_states" ADD CONSTRAINT "solution_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_states" ADD CONSTRAINT "solution_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_states" ADD CONSTRAINT "solution_states_confirmed_snapshot_id_solution_snapshots_id_fk" FOREIGN KEY ("confirmed_snapshot_id") REFERENCES "public"."solution_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "solution_snapshots_state_idx" ON "solution_snapshots" USING btree ("solution_state_id");--> statement-breakpoint
CREATE INDEX "solution_snapshots_conversation_idx" ON "solution_snapshots" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "solution_snapshots_project_idx" ON "solution_snapshots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "solution_snapshots_user_created_idx" ON "solution_snapshots" USING btree ("user_id","confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "solution_states_active_conversation_idx" ON "solution_states" USING btree ("conversation_id") WHERE "solution_states"."active" = true;--> statement-breakpoint
CREATE INDEX "solution_states_conversation_created_idx" ON "solution_states" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "solution_states_project_idx" ON "solution_states" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "solution_states_user_stage_idx" ON "solution_states" USING btree ("user_id","stage");
--> statement-breakpoint
CREATE FUNCTION "reject_solution_snapshot_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '已确认方案快照不可修改或删除';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "solution_snapshots_immutable" BEFORE UPDATE OR DELETE ON "solution_snapshots"
FOR EACH ROW EXECUTE FUNCTION "reject_solution_snapshot_mutation"();
