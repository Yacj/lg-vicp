CREATE TABLE "report_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(32) DEFAULT 'default' NOT NULL,
	"default_report_type" varchar(80),
	"cover_title" varchar(200),
	"show_calculation_process" boolean DEFAULT true NOT NULL,
	"show_source_references" boolean DEFAULT true NOT NULL,
	"show_disclaimer" boolean DEFAULT true NOT NULL,
	"disclaimer_text" text,
	"header_text" varchar(200),
	"footer_text" varchar(200),
	"default_export_format" varchar(16) DEFAULT 'PDF' NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_settings_key_unique" ON "report_settings" USING btree ("key");