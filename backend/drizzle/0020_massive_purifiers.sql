ALTER TABLE "standard_applicability" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "standard_applicability" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "standard_sources" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "standard_sources" ADD CONSTRAINT "standard_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;