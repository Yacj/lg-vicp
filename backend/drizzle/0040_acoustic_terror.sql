CREATE TYPE "public"."ai_agent_run_status" AS ENUM('RUNNING', 'WAITING_USER_INPUT', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."project_ai_memory_created_by" AS ENUM('USER', 'AI');--> statement-breakpoint
CREATE TYPE "public"."project_ai_memory_status" AS ENUM('ACTIVE', 'PENDING', 'SUPERSEDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."project_ai_memory_type" AS ENUM('FACT', 'CONSTRAINT', 'DECISION', 'PREFERENCE', 'TODO', 'ASSUMPTION');--> statement-breakpoint
CREATE TABLE "ai_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_message_id" uuid,
	"assistant_message_id" uuid,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"status" "ai_agent_run_status" DEFAULT 'RUNNING' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"allowed_tools_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" varchar(160),
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"token_usage_json" jsonb,
	"error_message" text,
	"error_code" varchar(40),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_conversation_states" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"summary" text,
	"active_goal" text,
	"confirmed_facts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"important_references_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_summarized_message_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_ai_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"memory_type" "project_ai_memory_type" NOT NULL,
	"title" varchar(160),
	"content" text NOT NULL,
	"structured_data_json" jsonb,
	"status" "project_ai_memory_status" DEFAULT 'PENDING' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"source_conversation_id" uuid,
	"source_message_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" "project_ai_memory_created_by" DEFAULT 'AI' NOT NULL,
	"superseded_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD COLUMN "semantic_summary" text;--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD COLUMN "detected_objects_json" jsonb;--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD COLUMN "vision_model" varchar(160);--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD COLUMN "input_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_trigger_message_id_ai_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_assistant_message_id_ai_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_states" ADD CONSTRAINT "ai_conversation_states_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_states" ADD CONSTRAINT "ai_conversation_states_last_summarized_message_id_ai_messages_id_fk" FOREIGN KEY ("last_summarized_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ai_memories" ADD CONSTRAINT "project_ai_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ai_memories" ADD CONSTRAINT "project_ai_memories_source_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ai_memories" ADD CONSTRAINT "project_ai_memories_superseded_by_id_project_ai_memories_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."project_ai_memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ai_memories" ADD CONSTRAINT "project_ai_memories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_runs_conversation_status_idx" ON "ai_agent_runs" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "ai_agent_runs_user_started_idx" ON "ai_agent_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "project_ai_memories_project_status_idx" ON "project_ai_memories" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_ai_memories_project_type_idx" ON "project_ai_memories" USING btree ("project_id","memory_type");--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_agent_run_id_ai_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."ai_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tool_calls_agent_run_idx" ON "ai_tool_calls" USING btree ("agent_run_id");