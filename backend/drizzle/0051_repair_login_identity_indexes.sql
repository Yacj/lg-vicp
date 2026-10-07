-- 前向补齐曾漏登记的 0032：已升级正确索引的数据库直接跳过，未升级数据库先检查归一化冲突。
-- 0032 仅修正 CASE 索引表达式括号；已有较新 Drizzle 水位不会重放它，改由此迁移补齐。
DO $$
DECLARE
  identity_conflicts text;
  phone_conflicts text;
  email_conflicts text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'user_identities_type_identifier_unique')
     AND EXISTS (SELECT 1 FROM pg_indexes p JOIN pg_index i ON i.indexrelid = to_regclass('public.user_identities_identifier_unique')
       WHERE p.schemaname = 'public' AND p.indexname = 'user_identities_identifier_unique'
       AND i.indisunique AND i.indisvalid AND p.indexdef LIKE '%CASE%' AND p.indexdef LIKE '%btrim%identifier%'
       AND p.indexdef LIKE '%lower%btrim%identifier%' AND p.indexdef LIKE '%WHERE (deleted_at IS NULL)%')
     AND EXISTS (SELECT 1 FROM pg_indexes p JOIN pg_index i ON i.indexrelid = to_regclass('public.users_phone_unique')
       WHERE p.schemaname = 'public' AND p.indexname = 'users_phone_unique'
       AND i.indisunique AND i.indisvalid AND p.indexdef LIKE '%btrim%phone%' AND p.indexdef LIKE '%WHERE (deleted_at IS NULL)%')
     AND EXISTS (SELECT 1 FROM pg_indexes p JOIN pg_index i ON i.indexrelid = to_regclass('public.users_email_unique')
       WHERE p.schemaname = 'public' AND p.indexname = 'users_email_unique'
       AND i.indisunique AND i.indisvalid AND p.indexdef LIKE '%lower%email%' AND p.indexdef LIKE '%WHERE (deleted_at IS NULL)%') THEN
    RETURN;
  END IF;
  LOCK TABLE "users", "user_identities" IN SHARE ROW EXCLUSIVE MODE;
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


DROP INDEX IF EXISTS "user_identities_type_identifier_unique";
DROP INDEX IF EXISTS "users_phone_unique";
DROP INDEX IF EXISTS "users_email_unique";
DROP INDEX IF EXISTS "user_identities_identifier_unique";
CREATE UNIQUE INDEX "user_identities_identifier_unique" ON "user_identities" USING btree ((case when btrim("identifier") ~ '^\\+?[0-9]{6,20}$' then btrim("identifier") else lower(btrim("identifier")) end)) WHERE "user_identities"."deleted_at" is null;
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree (btrim("phone")) WHERE "users"."deleted_at" is null;
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email")) WHERE "users"."deleted_at" is null;

END $$;
