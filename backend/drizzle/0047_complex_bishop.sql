ALTER TABLE "catalog_products" ADD COLUMN "product_type" varchar(80);--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "spec_class" "md_spec_class";--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "thermal_conductivity" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "correction_factor" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "thickness_options_mm" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_specs" ADD COLUMN "catalog_product_id" uuid;--> statement-breakpoint
ALTER TABLE "report_context_snapshots" ADD COLUMN "reference_pages_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD COLUMN "catalog_product_id" uuid;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD COLUMN "source_page_id" uuid;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD COLUMN "source_page_label" varchar(32);--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_specs" ADD CONSTRAINT "product_specs_catalog_product_id_catalog_products_id_fk" FOREIGN KEY ("catalog_product_id") REFERENCES "public"."catalog_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_catalog_product_id_catalog_products_id_fk" FOREIGN KEY ("catalog_product_id") REFERENCES "public"."catalog_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_source_document_id_knowledge_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thermal_reference_rows" ADD CONSTRAINT "thermal_reference_rows_source_page_id_knowledge_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."knowledge_pages"("id") ON DELETE set null ON UPDATE no action;