import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { standardDocuments } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { readReferenceFactHistory } from "./reference-fact-history.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { resolveScopedThermalStandard } from "../thermal/thermal-standard-scope.service.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";

const complianceSchema = z.object({ status: z.enum(["NEEDS_INPUT", "UNAVAILABLE", "CHECKED"]), field: z.string().optional(),
  standardLimitId: z.uuid().optional(), scope: z.object({ regionCode: z.string(), buildingType: z.string(), structureType: z.string().optional() }).optional() });
type Conversation = { id: string; userId: string; projectId: string | null; clientApp: string };
/** 只绑定紧邻本人同端同项目的实际核验；不从助手正文抽取法规事实。 */
export function previousComplianceContext(rows: readonly { id: string; createdAt: Date; metadata: unknown }[], conversation: Conversation, now = Date.now()) {
  const row = rows[0];
  const m = row?.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; compliance?: unknown;
    complianceReadContext?: { createdAt?: string; compliance?: unknown } } } | undefined;
  const scope = m?.queryScope;
  const carried = m?.backendDecision?.domainIntent === "KNOWLEDGE_EXPLAIN" ? m.backendDecision.complianceReadContext : undefined;
  const createdAt = carried?.createdAt ? new Date(carried.createdAt) : row?.createdAt;
  if (!row || scope?.id !== conversation.id || scope.userId !== conversation.userId || scope.clientApp !== conversation.clientApp
    || scope.projectId !== conversation.projectId || !Number.isFinite(row.createdAt.getTime()) || row.createdAt.getTime() > now
    || !createdAt || !Number.isFinite(createdAt.getTime()) || now < createdAt.getTime() || now - createdAt.getTime() > 24 * 3600_000
    || m?.backendDecision?.domainIntent !== "COMPLIANCE_CHECK" && !carried) return undefined;
  const parsed = complianceSchema.safeParse(carried?.compliance ?? m?.backendDecision?.compliance);
  return parsed.success ? { messageId: row.id, createdAt: createdAt.toISOString(), compliance: parsed.data } : undefined;
}

/** 依据解释只走当前正式来源；不生成合规结论、不重算、不创建候选或报告。 */
export async function readComplianceExplanation(ctx: ReferenceReadContext) {
  const semantic = ctx.domainDecision?.semantic;
  if (!semantic?.complianceExplanation || applyDomainPolicy(ctx.userMessage ?? "", semantic, ctx.taskState).intent !== "KNOWLEDGE_EXPLAIN")
    throw new Error("本轮没有已核验的标准依据解释目标");
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  const context = previousComplianceContext(await readReferenceFactHistory(ctx.app, ctx.conversation.id), ctx.conversation);
  const reply = (answer: string, sources: unknown[] = []) => ({ answer, sources, context });
  if (!context) return reply("当前没有可接续的标准核验记录。可以说明项目地区和建筑类型，或提供正式标准文件，我再帮你核对。");
  const previous = context.compliance;
  if (previous.status !== "CHECKED" || !previous.standardLimitId || !previous.scope) {
    const dictionary = await loadThermalQueryDictionary(ctx.app.db);
    return reply(dictionary.hasPublishedLimits === false
      ? "目前资料里还没有可引用的正式标准限值，因此无法提供对应的标准版本、条文和生效日期，也不能据此判断是否达标。可以提供正式标准文件，我再帮你核对。"
      : "上次核验还没有得到可引用的适用标准依据。可以提供正式标准文件，或重新核对项目地区和建筑类型，再确定适用的条文与限值。");
  }
  const current = await resolveScopedThermalStandard(ctx.app.db, { ...previous.scope, standardLimitId: previous.standardLimitId });
  if (!current.limit) return reply("上次引用的标准目前无法重新核验，暂不能沿用其条文或限值。请重新核对正式标准及适用范围。");
  const limit = current.limit;
  const document = limit.sourceDocumentId ? (await ctx.app.db.select().from(standardDocuments).where(and(eq(standardDocuments.id, limit.sourceDocumentId),
    ...publishedReferenceConditions(standardDocuments))).limit(1))[0] : undefined;
  if (!document || !limit.basisCode || document.documentNo !== limit.basisCode || !limit.clauseRef)
    return reply("标准限值尚未对应到可核验的正式原文和条款，暂不能提供确定的标准版本或实施日期。可以提供正式文件继续核对。");
  // 实施日期来自正式标准文档，不能拿后台记录版本号或发布时间冒充法规版本、生效日期。
  const date = document.implementDate?.toISOString().slice(0, 10) ?? "资料未提供";
  return reply(`目前可核对的标准依据是《${document.title}》（${document.documentNo}），条文 ${limit.clauseRef}。\n该项 K 限值为 ${limit.limitKValue} W/(m²·K)。实施日期：${date}。\n本次仅核对标准资料，没有重新判定项目是否达标。`,
    [{ documentId: limit.sourceDocumentId, title: limit.basisName, basisCode: limit.basisCode, clauseRef: limit.clauseRef, version: limit.version }]);
}
