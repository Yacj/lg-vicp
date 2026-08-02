CREATE TYPE "public"."ai_prompt_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "ai_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(80) NOT NULL,
	"description" text,
	"default_model_id" uuid,
	"reasoning_model_id" uuid,
	"fallback_model_id" uuid,
	"allow_reasoning" boolean DEFAULT false NOT NULL,
	"require_project" boolean DEFAULT false NOT NULL,
	"allow_file_upload" boolean DEFAULT false NOT NULL,
	"allow_knowledge_search" boolean DEFAULT false NOT NULL,
	"allow_tools" boolean DEFAULT false NOT NULL,
	"temperature" real,
	"max_output_tokens" integer,
	"prompt_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_scenes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"status" "ai_prompt_version_status" DEFAULT 'DRAFT' NOT NULL,
	"change_note" text,
	"created_by_id" uuid,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(80) NOT NULL,
	"description" text,
	"active_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "group_id" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD COLUMN "reason_code" varchar(40);--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD COLUMN "handled_by_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD COLUMN "handling_note" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "model_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "prompt_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "error_code" varchar(40);--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "request_id" varchar(120);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "code" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "code" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "timeout_ms" integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_test_status" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_test_message" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_scenes" ADD CONSTRAINT "ai_scenes_default_model_id_ai_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scenes" ADD CONSTRAINT "ai_scenes_reasoning_model_id_ai_models_id_fk" FOREIGN KEY ("reasoning_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scenes" ADD CONSTRAINT "ai_scenes_fallback_model_id_ai_models_id_fk" FOREIGN KEY ("fallback_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scenes" ADD CONSTRAINT "ai_scenes_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_scene_id_ai_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."ai_scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_active_version_id_prompt_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_scenes_enabled_sort_idx" ON "ai_scenes" USING btree ("enabled","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_prompt_version_unique" ON "prompt_versions" USING btree ("prompt_id","version");--> statement-breakpoint
CREATE INDEX "prompt_versions_status_idx" ON "prompt_versions" USING btree ("prompt_id","status");--> statement-breakpoint
CREATE INDEX "prompts_scene_idx" ON "prompts" USING btree ("scene_id");--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD CONSTRAINT "ai_message_feedbacks_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE set null ON UPDATE no action;