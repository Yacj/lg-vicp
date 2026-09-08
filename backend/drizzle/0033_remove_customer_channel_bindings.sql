-- 删除历史客户档案、项目客户绑定和用户渠道归属数据。
-- 同时将历史渠道数据范围映射为 PROJECT_OWNER，再重建枚举。
DROP INDEX IF EXISTS "projects_customer_idx";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_customer_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "customer_id";--> statement-breakpoint
DROP TABLE IF EXISTS "customer_profiles";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_channel_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_parent_channel_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "channel_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "parent_channel_id";--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "data_scope" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "data_scope" TYPE text USING "data_scope"::text;--> statement-breakpoint
UPDATE "roles" SET "data_scope" = 'PROJECT_OWNER' WHERE "data_scope" IN ('CHANNEL', 'CHANNEL_AND_CHILDREN');--> statement-breakpoint
DROP TYPE "public"."data_scope";--> statement-breakpoint
CREATE TYPE "public"."data_scope" AS ENUM('ALL', 'DEPT', 'DEPT_AND_CHILDREN', 'SELF', 'CUSTOM', 'PROJECT_OWNER');--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "data_scope" TYPE "data_scope" USING "data_scope"::"data_scope";--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "data_scope" SET DEFAULT 'SELF';