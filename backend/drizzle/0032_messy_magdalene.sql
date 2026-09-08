-- 登录标识收紧为全局唯一。先把历史软删除账号的身份置为无效，再检测归一化冲突。
-- 发现冲突时迁移明确失败并列出记录，不删除、覆盖或自动选择账号。
DO $$
DECLARE
  identity_conflicts text;
  phone_conflicts text;
  email_conflicts text;
BEGIN
  UPDATE "user_identities" AS ui
  SET "deleted_at" = COALESCE(ui."deleted_at", now()), "updated_at" = now()
  FROM "users" AS u
  WHERE u."id" = ui."user_id" AND u."deleted_at" IS NOT NULL AND ui."deleted_at" IS NULL;

  SELECT string_agg(format('%s [%s]', normalized_identifier, identity_ids), '; ')
  INTO identity_conflicts
  FROM (
    SELECT
      CASE
        WHEN btrim("identifier") ~ '^\\+?[0-9]{6,20}$' THEN btrim("identifier")
        ELSE lower(btrim("identifier"))
      END AS normalized_identifier,
      string_agg("id"::text, ', ' ORDER BY "id") AS identity_ids
    FROM "user_identities"
    WHERE "deleted_at" IS NULL
    GROUP BY 1
    HAVING count(*) > 1
    LIMIT 20
  ) AS conflicts;

  IF identity_conflicts IS NOT NULL THEN
    RAISE EXCEPTION '无法建立全局登录标识唯一性，存在冲突：%', identity_conflicts USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(format('%s [%s]', normalized_phone, user_ids), '; ')
  INTO phone_conflicts
  FROM (
    SELECT btrim("phone") AS normalized_phone, string_agg("id"::text, ', ' ORDER BY "id") AS user_ids
    FROM "users"
    WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL
    GROUP BY 1
    HAVING count(*) > 1
    LIMIT 20
  ) AS conflicts;
  IF phone_conflicts IS NOT NULL THEN
    RAISE EXCEPTION '无法建立手机号唯一性，存在冲突：%', phone_conflicts USING ERRCODE = '23505';
  END IF;

  SELECT string_agg(format('%s [%s]', normalized_email, user_ids), '; ')
  INTO email_conflicts
  FROM (
    SELECT lower(btrim("email")) AS normalized_email, string_agg("id"::text, ', ' ORDER BY "id") AS user_ids
    FROM "users"
    WHERE "deleted_at" IS NULL AND "email" IS NOT NULL
    GROUP BY 1
    HAVING count(*) > 1
    LIMIT 20
  ) AS conflicts;
  IF email_conflicts IS NOT NULL THEN
    RAISE EXCEPTION '无法建立邮箱唯一性，存在冲突：%', email_conflicts USING ERRCODE = '23505';
  END IF;

  UPDATE "user_identities"
  SET "identifier" = CASE
    WHEN btrim("identifier") ~ '^\\+?[0-9]{6,20}$' THEN btrim("identifier")
    ELSE lower(btrim("identifier"))
  END,
  "updated_at" = now()
  WHERE "identifier" <> CASE
    WHEN btrim("identifier") ~ '^\\+?[0-9]{6,20}$' THEN btrim("identifier")
    ELSE lower(btrim("identifier"))
  END;
  UPDATE "users" SET "phone" = btrim("phone"), "updated_at" = now()
  WHERE "phone" IS NOT NULL AND "phone" <> btrim("phone");
  UPDATE "users" SET "email" = lower(btrim("email")), "updated_at" = now()
  WHERE "email" IS NOT NULL AND "email" <> lower(btrim("email"));
END $$;
--> statement-breakpoint
DROP INDEX "user_identities_type_identifier_unique";--> statement-breakpoint
DROP INDEX "users_phone_unique";--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_identifier_unique" ON "user_identities" USING btree (case when btrim("identifier") ~ '^\\+?[0-9]{6,20}$' then btrim("identifier") else lower(btrim("identifier")) end) WHERE "user_identities"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree (btrim("phone")) WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email")) WHERE "users"."deleted_at" is null;
