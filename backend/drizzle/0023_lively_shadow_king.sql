CREATE TYPE "public"."knowledge_chunk_edit_type" AS ENUM('META_EDIT', 'FLAG_INVALID', 'SPLIT', 'MERGE');--> statement-breakpoint
CREATE TABLE "knowledge_chunk_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"edit_type" "knowledge_chunk_edit_type" NOT NULL,
	"note" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "annotation" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "invalid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "invalid_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "edited_by_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_edits" ADD CONSTRAINT "knowledge_chunk_edits_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk_edits" ADD CONSTRAINT "knowledge_chunk_edits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_edits_chunk_idx" ON "knowledge_chunk_edits" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_edits_created_idx" ON "knowledge_chunk_edits" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;