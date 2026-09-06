ALTER TYPE "public"."file_status" ADD VALUE 'RECYCLED';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "recycled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "recycled_by_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_recycled_by_id_users_id_fk" FOREIGN KEY ("recycled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_mimetype_idx" ON "files" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "files_status_created_idx" ON "files" USING btree ("status","created_at");