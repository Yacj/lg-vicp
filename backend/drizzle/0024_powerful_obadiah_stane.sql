DROP INDEX "user_identities_type_identifier_unique";--> statement-breakpoint
DROP INDEX "users_phone_unique";--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_type_identifier_unique" ON "user_identities" USING btree ("type","identifier") WHERE "user_identities"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;--> statement-breakpoint
UPDATE "user_identities" SET "deleted_at" = now() WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "deleted_at" IS NOT NULL);