CREATE TYPE "public"."ai_attachment_type" AS ENUM('IMAGE');--> statement-breakpoint
CREATE TYPE "public"."ai_vision_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('GENERAL', 'CHAT_IMAGE');--> statement-breakpoint
CREATE TABLE "ai_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"attachment_type" "ai_attachment_type" DEFAULT 'IMAGE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"vision_status" "ai_vision_status" DEFAULT 'PENDING' NOT NULL,
	"vision_result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "purpose" "file_purpose" DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_templates" ADD COLUMN "requires_project" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD CONSTRAINT "ai_message_attachments_message_id_ai_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_attachments" ADD CONSTRAINT "ai_message_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_message_attachments_message_file_unique" ON "ai_message_attachments" USING btree ("message_id","file_id");--> statement-breakpoint
CREATE INDEX "ai_message_attachments_message_idx" ON "ai_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ai_message_attachments_file_idx" ON "ai_message_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "files_purpose_idx" ON "files" USING btree ("purpose");--> statement-breakpoint
UPDATE "report_templates" SET "requires_project" = true WHERE "code" = 'standard_report';