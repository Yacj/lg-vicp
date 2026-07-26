ALTER TYPE "public"."share_target_type" ADD VALUE 'PROJECT';--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_status_pin_updated_idx" ON "ai_conversations" USING btree ("user_id","status","is_pinned","updated_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_deleted_idx" ON "ai_conversations" USING btree ("deleted_at");