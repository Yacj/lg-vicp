import { and, desc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Database } from "../../db/client.js";
import { aiScenes, prompts, promptVersions } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { NotFoundError } from "../../shared/errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { publishPromptVersion, updatePromptDraft } from "./ai-config.service.js";
import {
  BUSINESS_PROMPT_CATALOG,
  DEFAULT_BUSINESS_PROMPT_CONTENT,
  findBusinessPromptMeta,
  type BusinessPromptCode
} from "./ai-business-prompt.catalog.js";

export type BusinessPromptDto = {
  id: string;
  code: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

async function loadPromptBySceneCode(db: Database, sceneCode: string) {
  const [row] = await db.select({
    prompt: prompts,
    version: promptVersions,
    scene: aiScenes
  }).from(prompts)
    .innerJoin(aiScenes, eq(aiScenes.id, prompts.sceneId))
    .leftJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
    .where(eq(aiScenes.code, sceneCode))
    .limit(1);
  return row;
}

function toDto(
  meta: (typeof BUSINESS_PROMPT_CATALOG)[number],
  row: Awaited<ReturnType<typeof loadPromptBySceneCode>>
): BusinessPromptDto {
  const updatedAt = row?.prompt.updatedAt ?? new Date();
  return {
    id: row?.prompt.id ?? meta.code,
    code: meta.code,
    name: meta.name,
    description: meta.description,
    content: row?.version?.content ?? DEFAULT_BUSINESS_PROMPT_CONTENT[meta.code],
    enabled: row?.version?.status === "PUBLISHED",
    updatedBy: row?.version?.publishedById ?? row?.version?.createdById ?? null,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : new Date(updatedAt).toISOString()
  };
}

export async function listBusinessPrompts(db: Database) {
  const items: BusinessPromptDto[] = [];
  for (const meta of BUSINESS_PROMPT_CATALOG) {
    items.push(toDto(meta, await loadPromptBySceneCode(db, meta.sceneCode)));
  }
  return items;
}

export async function getBusinessPrompt(db: Database, code: string) {
  const meta = findBusinessPromptMeta(code);
  if (!meta) throw new NotFoundError("业务提示词不存在");
  return toDto(meta, await loadPromptBySceneCode(db, meta.sceneCode));
}

async function writeBusinessPromptContent(input: {
  db: Database;
  request: FastifyRequest;
  actor: AuthUser;
  code: BusinessPromptCode;
  content: string;
  action: string;
}) {
  const meta = findBusinessPromptMeta(input.code)!;
  const row = await loadPromptBySceneCode(input.db, meta.sceneCode);
  if (!row) throw new NotFoundError("业务提示词尚未初始化，请先执行数据库种子");
  const { draft } = await updatePromptDraft(input.db, row.prompt.id, {
    name: meta.name,
    description: meta.description,
    content: input.content,
    changeNote: "业务提示词保存",
    updatedById: input.actor.id
  });
  const latestDraft = await input.db.select().from(promptVersions)
    .where(and(eq(promptVersions.promptId, row.prompt.id), eq(promptVersions.status, "DRAFT")))
    .orderBy(desc(promptVersions.version))
    .limit(1);
  const versionId = latestDraft[0]?.id ?? draft.id;
  if (latestDraft[0] || draft.status === "DRAFT") {
    await publishPromptVersion(input.db, row.prompt.id, versionId, input.actor.id);
  }
  await writeAuditLog({
    db: input.db,
    request: input.request,
    actor: input.actor,
    action: input.action,
    targetType: "ai_business_prompt",
    targetId: row.prompt.id,
    afterJson: { code: input.code, content: input.content }
  });
  return getBusinessPrompt(input.db, input.code);
}

export async function updateBusinessPrompt(
  db: Database,
  request: FastifyRequest,
  actor: AuthUser,
  code: string,
  content: string
) {
  const meta = findBusinessPromptMeta(code);
  if (!meta) throw new NotFoundError("业务提示词不存在");
  return writeBusinessPromptContent({
    db, request, actor, code: meta.code, content, action: AUDIT_ACTIONS.AI_BUSINESS_PROMPT_UPDATED
  });
}

export async function resetBusinessPrompt(
  db: Database,
  request: FastifyRequest,
  actor: AuthUser,
  code: string
) {
  const meta = findBusinessPromptMeta(code);
  if (!meta) throw new NotFoundError("业务提示词不存在");
  return writeBusinessPromptContent({
    db,
    request,
    actor,
    code: meta.code,
    content: DEFAULT_BUSINESS_PROMPT_CONTENT[meta.code],
    action: AUDIT_ACTIONS.AI_BUSINESS_PROMPT_RESET
  });
}
