/**
 * 项目长期记忆：同一项目下多个 Conversation 共享。
 * LLM 只提出 candidate，不能直接覆盖 verified 记录；冲突时旧记录 SUPERSEDED 并保留来源链。
 */
import { generateObject } from "ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { aiConversations, aiMessages, projectAiMemories, projects } from "../../db/schema.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { resolveSceneRuntime } from "./ai-runtime.service.js";

export const MEMORY_TYPES = ["FACT", "CONSTRAINT", "DECISION", "PREFERENCE", "TODO", "ASSUMPTION"] as const;
export type ProjectMemoryType = (typeof MEMORY_TYPES)[number];
export const MEMORY_STATUSES = ["ACTIVE", "PENDING", "SUPERSEDED", "REJECTED"] as const;
export type ProjectMemoryStatus = (typeof MEMORY_STATUSES)[number];

export type MemoryCandidate = {
  memoryType: ProjectMemoryType;
  title?: string;
  content: string;
  structuredData?: Record<string, unknown>;
  confidence: number;
  sourceMessageIds: string[];
  explicitUserStatement: boolean;
};

export type InjectableMemory = {
  id: string;
  memoryType: ProjectMemoryType;
  title: string | null;
  content: string;
  verified: boolean;
  status: string;
};

const candidateOutputSchema = z.object({
  candidates: z.array(z.object({
    memoryType: z.enum(MEMORY_TYPES),
    title: z.string().max(160).optional(),
    content: z.string().min(1),
    structuredData: z.record(z.string(), z.unknown()).optional(),
    confidence: z.number().min(0).max(1),
    sourceMessageIds: z.array(z.string()),
    explicitUserStatement: z.boolean()
  }))
});

export const MEMORY_EXTRACT_SYSTEM_PROMPT = `你是项目记忆抽取器。只抽取对项目有长期价值的信息。
允许：项目明确条件、用户明确选择、已确认方案、约束、重要偏好、待确认事项。
禁止：寒暄、普通知识问答、AI 随口建议、未证实数字、无长期价值的内容。
用户明确说“就采用第二个方案”“目标K改成0.30”等，标记 explicitUserStatement=true，可作高置信 FACT/DECISION/CONSTRAINT。
AI 推测（如“用户可能偏好 25mm”）只能是 ASSUMPTION，explicitUserStatement=false，不能当已核实事实。
使用中文。没有值得保存的信息时返回空数组。`;

export function normalizeMemoryKey(content: string): string {
  return content.replace(/\s+/g, "").replace(/[。．.，,；;：:]/g, "").toLowerCase();
}

export function isInjectableAsFact(memory: {
  status: string;
  verified: boolean;
  memoryType: string;
}): boolean {
  return memory.status === "ACTIVE" && memory.verified && memory.memoryType !== "ASSUMPTION";
}

export function formatProjectMemoryContext(memories: InjectableMemory[]): string | null {
  if (memories.length === 0) return null;
  const facts = memories.filter((item) => isInjectableAsFact(item));
  const pending = memories.filter((item) => item.memoryType === "TODO" && item.verified);
  if (facts.length === 0 && pending.length === 0) return null;
  const lines = [
    ...facts.map((item) => `- [${item.memoryType}] ${item.title ? `${item.title}：` : ""}${item.content}`),
    ...pending.map((item) => `- [待办] ${item.content}`)
  ];
  return [
    "【项目长期记忆（仅已确认项；假设不得当事实）】",
    ...lines
  ].join("\n");
}

export async function assertProjectMemoryAccess(
  app: FastifyInstance,
  user: AuthUser,
  projectId: string,
  mode: "view" | "manage"
) {
  const [project] = await app.db.select().from(projects)
    .where(eq(projects.id, projectId)).limit(1);
  if (!project || project.deletedAt) throw new NotFoundError("项目不存在或无权查看");
  if (!canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");
  if (mode === "manage" && !canManageProject(user, project)) {
    throw new ForbiddenError("只有项目创建者或超级管理员可以修改项目记忆");
  }
  return project;
}

export async function listProjectMemories(
  app: FastifyInstance,
  projectId: string,
  query: { view?: "active" | "pending" | "history" } = {}
) {
  const view = query.view ?? "active";
  const statusFilter = view === "active"
    ? ["ACTIVE"]
    : view === "pending"
      ? ["PENDING"]
      : ["SUPERSEDED", "REJECTED"];
  return app.db.select().from(projectAiMemories)
    .where(and(
      eq(projectAiMemories.projectId, projectId),
      inArray(projectAiMemories.status, statusFilter as Array<"ACTIVE" | "PENDING" | "SUPERSEDED" | "REJECTED">)
    ))
    .orderBy(desc(projectAiMemories.updatedAt));
}

export async function listInjectableProjectMemories(app: FastifyInstance, projectId: string): Promise<InjectableMemory[]> {
  const rows = await app.db.select().from(projectAiMemories)
    .where(and(
      eq(projectAiMemories.projectId, projectId),
      eq(projectAiMemories.status, "ACTIVE")
    ))
    .orderBy(desc(projectAiMemories.updatedAt))
    .limit(50);
  return rows.filter((row) => isInjectableAsFact(row) || (row.memoryType === "TODO" && row.verified)).map((row) => ({
    id: row.id,
    memoryType: row.memoryType,
    title: row.title,
    content: row.content,
    verified: row.verified,
    status: row.status
  }));
}

function sameTopic(a: string, b: string): boolean {
  const left = normalizeMemoryKey(a);
  const right = normalizeMemoryKey(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left) || left.slice(0, 24) === right.slice(0, 24);
}

/**
 * 合并候选：明确且高置信可覆盖同主题 verified 记录（旧 → SUPERSEDED）。
 * 不明确的候选进入 PENDING，不得静默覆盖。
 */
export function classifyMemoryCandidate(candidate: MemoryCandidate): {
  status: ProjectMemoryStatus;
  verified: boolean;
  memoryType: ProjectMemoryType;
} {
  if (!candidate.explicitUserStatement || candidate.confidence < 0.7) {
    return {
      status: "PENDING",
      verified: false,
      memoryType: candidate.explicitUserStatement ? candidate.memoryType : "ASSUMPTION"
    };
  }
  if (candidate.memoryType === "ASSUMPTION") {
    return { status: "PENDING", verified: false, memoryType: "ASSUMPTION" };
  }
  return { status: "ACTIVE", verified: true, memoryType: candidate.memoryType };
}

export async function mergeProjectMemoryCandidates(
  app: FastifyInstance,
  input: {
    projectId: string;
    conversationId: string;
    actor: AuthUser;
    candidates: MemoryCandidate[];
    request?: FastifyRequest;
  }
) {
  const existing = await app.db.select().from(projectAiMemories)
    .where(and(
      eq(projectAiMemories.projectId, input.projectId),
      inArray(projectAiMemories.status, ["ACTIVE", "PENDING"])
    ));

  const created: Array<typeof projectAiMemories.$inferSelect> = [];
  for (const candidate of input.candidates) {
    const classified = classifyMemoryCandidate(candidate);
    const conflict = existing.find((row) =>
      row.memoryType === classified.memoryType
      && sameTopic(row.content, candidate.content)
      && row.content.replace(/\s+/g, "") !== candidate.content.replace(/\s+/g, "")
    );

    if (conflict?.verified && classified.status !== "ACTIVE") {
      const [pending] = await app.db.insert(projectAiMemories).values({
        projectId: input.projectId,
        memoryType: classified.memoryType,
        title: candidate.title ?? null,
        content: candidate.content,
        structuredDataJson: candidate.structuredData ?? null,
        status: "PENDING",
        confidence: candidate.confidence,
        verified: false,
        sourceConversationId: input.conversationId,
        sourceMessageIdsJson: candidate.sourceMessageIds,
        createdBy: "AI",
        createdById: input.actor.id
      }).returning();
      if (pending) created.push(pending);
      continue;
    }

    const [inserted] = await app.db.insert(projectAiMemories).values({
      projectId: input.projectId,
      memoryType: classified.memoryType,
      title: candidate.title ?? null,
      content: candidate.content,
      structuredDataJson: candidate.structuredData ?? null,
      status: classified.status,
      confidence: candidate.confidence,
      verified: classified.verified,
      sourceConversationId: input.conversationId,
      sourceMessageIdsJson: candidate.sourceMessageIds,
      createdBy: candidate.explicitUserStatement ? "USER" : "AI",
      createdById: input.actor.id
    }).returning();
    if (!inserted) continue;
    created.push(inserted);

    if (conflict && classified.verified) {
      await app.db.update(projectAiMemories).set({
        status: "SUPERSEDED",
        supersededById: inserted.id,
        updatedAt: new Date()
      }).where(eq(projectAiMemories.id, conflict.id));
    }
  }
  return created;
}

export async function extractProjectMemoryCandidates(
  app: FastifyInstance,
  conversationId: string
): Promise<MemoryCandidate[]> {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(eq(aiConversations.id, conversationId)).limit(1);
  if (!conversation?.projectId) return [];

  const messages = await app.db.select({
    id: aiMessages.id,
    role: aiMessages.role,
    content: aiMessages.content
  }).from(aiMessages).where(and(
    eq(aiMessages.conversationId, conversationId),
    eq(aiMessages.status, "COMPLETED")
  )).orderBy(desc(aiMessages.createdAt)).limit(30);

  const transcript = messages.reverse()
    .filter((row) => row.role === "USER" || row.role === "ASSISTANT")
    .map((row) => `${row.role === "USER" ? "用户" : "助手"}(${row.id})：${row.content.slice(0, 800)}`)
    .join("\n");
  if (!transcript.trim()) return [];

  const runtime = await resolveSceneRuntime(app.db, conversation.scene, "OFF");
  const result = await generateObject({
    model: runtime.primary.languageModel,
    schema: candidateOutputSchema,
    system: MEMORY_EXTRACT_SYSTEM_PROMPT,
    prompt: `会话消息（括号内为 messageId，sourceMessageIds 必须来自这些 ID）：\n${transcript}`,
    maxOutputTokens: 1200,
    temperature: 0.1,
    abortSignal: AbortSignal.timeout(runtime.primary.timeoutMs)
  });

  const allowedIds = new Set(messages.map((row) => row.id));
  return result.object.candidates.map((item) => ({
    ...item,
    sourceMessageIds: item.sourceMessageIds.filter((id) => allowedIds.has(id))
  }));
}

export async function refreshProjectMemoryFromConversation(
  app: FastifyInstance,
  conversationId: string,
  actor: AuthUser,
  request?: FastifyRequest
) {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(eq(aiConversations.id, conversationId)).limit(1);
  if (!conversation?.projectId) return [];
  const candidates = await extractProjectMemoryCandidates(app, conversationId);
  if (candidates.length === 0) return [];
  return mergeProjectMemoryCandidates(app, {
    projectId: conversation.projectId,
    conversationId,
    actor,
    candidates,
    request
  });
}

export async function updateProjectMemory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  memoryId: string,
  patch: { title?: string | null; content?: string; memoryType?: ProjectMemoryType }
) {
  const [row] = await app.db.select().from(projectAiMemories).where(eq(projectAiMemories.id, memoryId)).limit(1);
  if (!row) throw new NotFoundError("项目记忆不存在");
  await assertProjectMemoryAccess(app, actor, row.projectId, "manage");
  const [updated] = await app.db.update(projectAiMemories).set({
    ...patch,
    updatedAt: new Date()
  }).where(eq(projectAiMemories.id, memoryId)).returning();
  await writeAuditLog({
    db: app.db, request, actor, projectId: row.projectId,
    action: AUDIT_ACTIONS.AI_MEMORY_UPDATED, targetType: "project_ai_memory", targetId: memoryId,
    beforeJson: row, afterJson: updated
  });
  return updated!;
}

export async function confirmProjectMemory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  memoryId: string
) {
  const [row] = await app.db.select().from(projectAiMemories).where(eq(projectAiMemories.id, memoryId)).limit(1);
  if (!row) throw new NotFoundError("项目记忆不存在");
  await assertProjectMemoryAccess(app, actor, row.projectId, "manage");
  const [updated] = await app.db.update(projectAiMemories).set({
    status: "ACTIVE",
    verified: true,
    updatedAt: new Date()
  }).where(eq(projectAiMemories.id, memoryId)).returning();
  await writeAuditLog({
    db: app.db, request, actor, projectId: row.projectId,
    action: AUDIT_ACTIONS.AI_MEMORY_CONFIRMED, targetType: "project_ai_memory", targetId: memoryId,
    afterJson: updated
  });
  return updated!;
}

export async function rejectProjectMemory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  memoryId: string
) {
  const [row] = await app.db.select().from(projectAiMemories).where(eq(projectAiMemories.id, memoryId)).limit(1);
  if (!row) throw new NotFoundError("项目记忆不存在");
  await assertProjectMemoryAccess(app, actor, row.projectId, "manage");
  const [updated] = await app.db.update(projectAiMemories).set({
    status: "REJECTED",
    verified: false,
    updatedAt: new Date()
  }).where(eq(projectAiMemories.id, memoryId)).returning();
  await writeAuditLog({
    db: app.db, request, actor, projectId: row.projectId,
    action: AUDIT_ACTIONS.AI_MEMORY_REJECTED, targetType: "project_ai_memory", targetId: memoryId,
    afterJson: updated
  });
  return updated!;
}

export async function deleteProjectMemory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  memoryId: string
) {
  return rejectProjectMemory(app, request, actor, memoryId);
}
