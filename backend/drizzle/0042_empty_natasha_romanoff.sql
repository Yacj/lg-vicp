CREATE TYPE "public"."ai_model_test_status" AS ENUM('UNTESTED', 'PASSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ai_reasoning_level" AS ENUM('LOW', 'HIGH', 'MAX');--> statement-breakpoint
ALTER TABLE "ai_models" ALTER COLUMN "enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "supports_vision" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "reasoning_level" "ai_reasoning_level" DEFAULT 'HIGH' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_test_status" "ai_model_test_status" DEFAULT 'UNTESTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "last_test_error" text;--> statement-breakpoint
UPDATE "ai_models" SET "supports_vision" = true WHERE coalesce(capabilities->>'vision', '') = 'true';--> statement-breakpoint
UPDATE "ai_models" SET "enabled" = false, "is_default" = false, "last_test_status" = 'UNTESTED', "last_test_error" = '模型配置已收口，请重新完成准入测试后再启用';