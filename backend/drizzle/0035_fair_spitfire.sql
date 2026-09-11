CREATE TYPE "public"."ai_quick_prompt_action_type" AS ENUM('AUTO', 'KNOWLEDGE', 'PROJECT', 'THERMAL', 'REPORT');--> statement-breakpoint
CREATE TYPE "public"."ai_quick_prompt_position" AS ENUM('AI_HOME', 'PROJECT_AI');--> statement-breakpoint
CREATE TYPE "public"."ai_scene_visibility" AS ENUM('USER', 'INTERNAL', 'ADMIN');--> statement-breakpoint
CREATE TABLE "ai_quick_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(80) NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"position" "ai_quick_prompt_position" DEFAULT 'AI_HOME' NOT NULL,
	"icon" varchar(40) DEFAULT 'book' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"action_type" "ai_quick_prompt_action_type" DEFAULT 'AUTO' NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_scenes" ADD COLUMN "visibility" "ai_scene_visibility" DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_quick_prompts" ADD CONSTRAINT "ai_quick_prompts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_quick_prompts" ADD CONSTRAINT "ai_quick_prompts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_quick_prompts_position_title_unique" ON "ai_quick_prompts" USING btree ("position","title");--> statement-breakpoint
CREATE INDEX "ai_quick_prompts_position_enabled_sort_idx" ON "ai_quick_prompts" USING btree ("position","enabled","sort_order");