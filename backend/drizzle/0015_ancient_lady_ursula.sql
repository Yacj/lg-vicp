ALTER TYPE "public"."ai_message_status" ADD VALUE 'BLOCKED';--> statement-breakpoint
CREATE TABLE "ai_content_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" varchar(100) NOT NULL,
	"match_type" varchar(20) DEFAULT 'CONTAINS' NOT NULL,
	"scene_codes" jsonb,
	"hit_message" varchar(200),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_content_filters" ADD CONSTRAINT "ai_content_filters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_content_filters" ADD CONSTRAINT "ai_content_filters_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_content_filters_enabled_idx" ON "ai_content_filters" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "ai_content_filters_keyword_idx" ON "ai_content_filters" USING btree ("keyword");