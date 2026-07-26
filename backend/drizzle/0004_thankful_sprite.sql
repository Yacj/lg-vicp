CREATE TYPE "public"."auth_client" AS ENUM('B_ADMIN', 'C_APP', 'PC_AI');--> statement-breakpoint
CREATE TYPE "public"."menu_type" AS ENUM('DIRECTORY', 'MENU', 'BUTTON');--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"menu_type" "menu_type" NOT NULL,
	"name" varchar(120) NOT NULL,
	"route_path" varchar(255),
	"component" varchar(255),
	"icon" varchar(120),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"permission_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "client_type" "auth_client" DEFAULT 'B_ADMIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menus_parent_sort_idx" ON "menus" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "menus_permission_idx" ON "menus" USING btree ("permission_code");--> statement-breakpoint
CREATE INDEX "menus_enabled_visible_idx" ON "menus" USING btree ("enabled","visible");