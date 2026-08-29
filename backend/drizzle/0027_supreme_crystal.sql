CREATE TYPE "public"."notification_type" AS ENUM('AI_FEEDBACK', 'STANDARD_PENDING_REVIEW', 'KNOWLEDGE_PARSE_FAILED', 'REPORT_GENERATION_FAILED');--> statement-breakpoint
ALTER TYPE "public"."data_scope" ADD VALUE 'CHANNEL';--> statement-breakpoint
ALTER TYPE "public"."data_scope" ADD VALUE 'CHANNEL_AND_CHILDREN';--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text,
	"target_type" varchar(80),
	"target_id" uuid,
	"project_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_crawler_sources" ADD COLUMN "last_crawled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_crawler_sources" ADD COLUMN "last_crawl_status" varchar(20);--> statement-breakpoint
ALTER TABLE "knowledge_crawler_sources" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "knowledge_crawler_sources" ADD COLUMN "operator_remark" text;--> statement-breakpoint
ALTER TABLE "standard_sources" ADD COLUMN "last_crawl_status" varchar(20);--> statement-breakpoint
ALTER TABLE "standard_sources" ADD COLUMN "last_crawl_summary" jsonb;--> statement-breakpoint
ALTER TABLE "standard_sources" ADD COLUMN "last_error_message" text;--> statement-breakpoint
ALTER TABLE "standard_sources" ADD COLUMN "operator_remark" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "channel_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "parent_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_reads_notification_user_unique" ON "notification_reads" USING btree ("notification_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_reads_user_read_idx" ON "notification_reads" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_type_created_idx" ON "notifications" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "notifications_project_idx" ON "notifications" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_channel_id_users_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_parent_channel_id_users_id_fk" FOREIGN KEY ("parent_channel_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;