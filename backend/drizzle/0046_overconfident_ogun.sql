CREATE TYPE "public"."app_access_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."app_code" AS ENUM('ADMIN', 'CLIENT');--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('SUPER_ADMIN', 'NORMAL_USER');--> statement-breakpoint
CREATE TABLE "user_app_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app" "app_code" NOT NULL,
	"role" "app_role" NOT NULL,
	"status" "app_access_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_app_access_user_app_unique" ON "user_app_access" USING btree ("user_id","app");--> statement-breakpoint
INSERT INTO "user_app_access" ("user_id", "app", "role", "status")
SELECT "id", 'ADMIN'::"app_code", 'SUPER_ADMIN'::"app_role", 'ACTIVE'::"app_access_status"
FROM "users"
WHERE "role" = 'SUPER_ADMIN' AND "deleted_at" IS NULL
ON CONFLICT ("user_id", "app") DO NOTHING;--> statement-breakpoint
INSERT INTO "user_app_access" ("user_id", "app", "role", "status")
SELECT "id", 'CLIENT'::"app_code", 'NORMAL_USER'::"app_role", 'ACTIVE'::"app_access_status"
FROM "users"
WHERE "role" IN ('NORMAL_USER', 'CHANNEL_USER') AND "deleted_at" IS NULL
ON CONFLICT ("user_id", "app") DO NOTHING;--> statement-breakpoint
INSERT INTO "user_app_access" ("user_id", "app", "role", "status")
SELECT DISTINCT "rt"."user_id", 'CLIENT'::"app_code", 'NORMAL_USER'::"app_role", 'ACTIVE'::"app_access_status"
FROM "refresh_tokens" "rt"
INNER JOIN "users" "u" ON "u"."id" = "rt"."user_id"
WHERE "rt"."client_type" IN ('C_APP', 'PC_AI') AND "u"."deleted_at" IS NULL
ON CONFLICT ("user_id", "app") DO NOTHING;