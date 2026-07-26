CREATE TYPE "public"."ai_reasoning_mode" AS ENUM('OFF', 'ON');--> statement-breakpoint
ALTER TYPE "public"."ai_message_status" ADD VALUE 'STREAMING' BEFORE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "public"."ai_message_status" ADD VALUE 'STOPPED' BEFORE 'FAILED';--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "reasoning_mode" "ai_reasoning_mode" DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "reasoning_mode" "ai_reasoning_mode" DEFAULT 'OFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "stop_reason" varchar(40);