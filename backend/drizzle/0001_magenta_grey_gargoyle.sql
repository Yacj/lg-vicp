CREATE TYPE "public"."ai_feedback_reaction" AS ENUM('LIKE', 'DISLIKE');--> statement-breakpoint
CREATE TYPE "public"."share_target_type" AS ENUM('AI_MESSAGES', 'REPORT', 'REPORT_ARTIFACT');--> statement-breakpoint
CREATE TABLE "ai_message_feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" uuid NOT NULL,
	"reaction" "ai_feedback_reaction",
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text,
	"client_app" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_message_regenerations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"original_message_id" uuid NOT NULL,
	"regenerated_message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"snapshot_content" text NOT NULL,
	"snapshot_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(80) NOT NULL,
	"target_type" "share_target_type" NOT NULL,
	"target_id" uuid,
	"project_id" uuid,
	"created_by_id" uuid,
	"title" varchar(160) NOT NULL,
	"snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"max_views" integer,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "share_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"referer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD CONSTRAINT "ai_message_feedbacks_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD CONSTRAINT "ai_message_feedbacks_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD CONSTRAINT "ai_message_feedbacks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_feedbacks" ADD CONSTRAINT "ai_message_feedbacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_regenerations" ADD CONSTRAINT "ai_message_regenerations_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_regenerations" ADD CONSTRAINT "ai_message_regenerations_original_message_id_ai_messages_id_fk" FOREIGN KEY ("original_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_regenerations" ADD CONSTRAINT "ai_message_regenerations_regenerated_message_id_ai_messages_id_fk" FOREIGN KEY ("regenerated_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_regenerations" ADD CONSTRAINT "ai_message_regenerations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_message_feedbacks_message_user_unique" ON "ai_message_feedbacks" USING btree ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "ai_message_feedbacks_project_created_idx" ON "ai_message_feedbacks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_feedbacks_reaction_created_idx" ON "ai_message_feedbacks" USING btree ("reaction","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_regenerations_conversation_created_idx" ON "ai_message_regenerations" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_message_regenerations_original_idx" ON "ai_message_regenerations" USING btree ("original_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sources_report_message_unique" ON "report_sources" USING btree ("report_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sources_report_sort_unique" ON "report_sources" USING btree ("report_id","sort_order");--> statement-breakpoint
CREATE INDEX "share_links_target_idx" ON "share_links" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "share_links_project_created_idx" ON "share_links" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "share_views_link_created_idx" ON "share_views" USING btree ("share_link_id","created_at");