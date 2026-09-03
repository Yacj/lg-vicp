CREATE TYPE "public"."knowledge_page_label_source" AS ENUM('PDF_PAGE_LABEL', 'FOOTER_TEXT', 'TOC_MAPPING', 'COMPANION_FILE', 'VISUAL_MATCH', 'MANUAL', 'FALLBACK');--> statement-breakpoint
ALTER TYPE "public"."knowledge_page_mapping_method" ADD VALUE 'COMPANION_FILE' BEFORE 'MANUAL';--> statement-breakpoint
ALTER TYPE "public"."knowledge_page_mapping_method" ADD VALUE 'VISUAL_MATCH' BEFORE 'MANUAL';--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "page_label_source" "knowledge_page_label_source" DEFAULT 'FALLBACK' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "page_label_confidence" real;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD COLUMN "page_label_verified" boolean DEFAULT false NOT NULL;