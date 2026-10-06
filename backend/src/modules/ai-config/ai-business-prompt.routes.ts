import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AI_PERMISSIONS } from "../../shared/ai-permissions.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { BUSINESS_PROMPT_CATALOG } from "./ai-business-prompt.catalog.js";
import { getBusinessPrompt, listBusinessPrompts, resetBusinessPrompt, updateBusinessPrompt } from "./ai-business-prompt.service.js";

const TAG = "B端 / 平台 / AI配置";
const codeParams = z.object({
  code: z.enum(BUSINESS_PROMPT_CATALOG.map((item) => item.code) as [string, ...string[]])
});
const updateBody = z.object({
  content: z.string().trim().min(10, "提示词内容至少需要 10 个字符").max(20_000, "提示词内容过长"),
  enabled: z.boolean().optional()
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有业务提示词管理权限");
  }
  return user;
}

export async function aiBusinessPromptRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/ai/business-prompts", {
    preHandler: [app.authenticate],
    schema: { tags: [TAG], summary: "列出业务提示词（不暴露版本/diff）" }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    return ok(request, { items: await listBusinessPrompts(app.db) });
  });

  route.get("/ai/business-prompts/:code", {
    preHandler: [app.authenticate],
    schema: { tags: [TAG], summary: "读取业务提示词", params: codeParams }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    return ok(request, await getBusinessPrompt(app.db, request.params.code));
  });

  route.put("/ai/business-prompts/:code", {
    preHandler: [app.authenticate],
    schema: { tags: [TAG], summary: "保存业务提示词并立即生效", params: codeParams, body: updateBody }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_EDIT);
    return ok(request, {
      message: "业务提示词已保存",
      prompt: await updateBusinessPrompt(app.db, request, actor, request.params.code, request.body.content)
    });
  });

  route.post("/ai/business-prompts/:code/reset-default", {
    preHandler: [app.authenticate],
    schema: { tags: [TAG], summary: "恢复业务提示词默认内容", params: codeParams }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_EDIT);
    return ok(request, {
      message: "已恢复默认提示词",
      prompt: await resetBusinessPrompt(app.db, request, actor, request.params.code)
    });
  });
}
