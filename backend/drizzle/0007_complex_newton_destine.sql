CREATE TYPE "public"."cron_execution_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."cron_job_status" AS ENUM('PAUSED', 'RUNNING', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."login_result" AS ENUM('SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."user_gender" AS ENUM('UNKNOWN', 'MALE', 'FEMALE');--> statement-breakpoint
CREATE TABLE "cron_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cron_job_id" uuid NOT NULL,
	"bull_job_id" varchar(120),
	"status" "cron_execution_status" DEFAULT 'QUEUED' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"job_type" varchar(80) NOT NULL,
	"cron_expression" varchar(120) NOT NULL,
	"queue_name" varchar(80) NOT NULL,
	"payload" jsonb,
	"status" "cron_job_status" DEFAULT 'PAUSED' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"identifier" varchar(255),
	"client_type" "auth_client",
	"result" "login_result" NOT NULL,
	"action" varchar(40) NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_departments" (
	"role_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_posts" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "leader" varchar(120);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "user_gender" DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "cron_executions" ADD CONSTRAINT "cron_executions_cron_job_id_cron_jobs_id_fk" FOREIGN KEY ("cron_job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_departments" ADD CONSTRAINT "role_departments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_posts" ADD CONSTRAINT "user_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_posts" ADD CONSTRAINT "user_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_executions_job_created_idx" ON "cron_executions" USING btree ("cron_job_id","created_at");--> statement-breakpoint
CREATE INDEX "cron_jobs_status_idx" ON "cron_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_jobs_name_unique" ON "cron_jobs" USING btree ("name");--> statement-breakpoint
CREATE INDEX "login_logs_created_idx" ON "login_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_logs_user_idx" ON "login_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_enabled_sort_idx" ON "posts" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "role_departments_unique" ON "role_departments" USING btree ("role_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_posts_unique" ON "user_posts" USING btree ("user_id","post_id");