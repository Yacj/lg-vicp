import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { files } from "../../db/schema.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { NotFoundError } from "../../shared/errors.js";
import { requireClient } from "../../shared/client-guard.js";
import { ok } from "../../shared/response.js";
import { listPublishedEnterpriseProfiles } from "./md-read.service.js";

/**
 * C 端只读企业内容（"关于蓝格智配"）：
 * 只返回 PUBLISHED + 生效中的正式企业内容，不依赖后台 RBAC 权限码；
 * 草稿、审核中、停用版本一律不可见。
 */
export async function masterdataClientRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/content/enterprise-profile", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.C_APP, AUTH_CLIENTS.PC_AI)],
    schema: {
      tags: ["C端 / 企业内容"],
      summary: "获取已发布企业介绍（关于蓝格智配，只读最新生效版本）"
    }
  }, async (request) => {
    getCurrentUser(request);
    const profiles = await listPublishedEnterpriseProfiles(app.db);
    const profile = profiles[0];
    if (!profile) throw new NotFoundError("企业介绍尚未发布");

    let logoUrl: string | null = null;
    if (profile.logoFileId) {
      const [file] = await app.db.select({
        objectKey: files.objectKey,
        originalName: files.originalName
      }).from(files).where(eq(files.id, profile.logoFileId)).limit(1);
      if (file) {
        logoUrl = await app.storage.createDownloadUrl(file.objectKey, file.originalName ?? "logo", 3600);
      }
    }

    return ok(request, {
      profile: {
        name: profile.name,
        shortName: profile.shortName,
        intro: profile.intro,
        address: profile.address,
        contactPhone: profile.contactPhone,
        contactEmail: profile.contactEmail,
        website: profile.website,
        logoUrl,
        version: profile.version,
        effectiveAt: profile.effectiveAt
      }
    });
  });
}
