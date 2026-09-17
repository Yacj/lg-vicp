/**
 * Agent Tool Registry：统一 name/description/inputSchema/execute，服务端校验 + 权限 + 超时。
 * 模型传入的 projectId/documentId/fileId 不可信，一律以会话与当前用户权限为准。
 */
import { createHash } from "node:crypto";
import { generateObject, tool } from "ai";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { aiMessages, aiToolCalls, reports } from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ReportError } from "../../shared/report-errors.js";
import { loadKnowledgeForGeneration } from "./ai-knowledge-load.js";
import { toAiSources } from "./ai-source.mapper.js";
import { formatKnowledgeContext } from "../knowledge/knowledge.service.js";
import { resolveProjectContext } from "./ai-project-profile.js";
import { listInjectableProjectMemories, formatProjectMemoryContext } from "./ai-project-memory.service.js";
import { executeThermalCalc } from "../thermal/thermal-calc.service.js";
import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import { thermalCalcRequestSchema } from "../thermal/thermal-calc.schemas.js";
import { thermalCandidateQueryFields, withCandidateQueryRefines } from "../thermal/thermal-candidate.schemas.js";
import { loadApprovedComparisonRules } from "../comparison/material-compare.service.js";
import { listPublicReportTypes, resolveReportType } from "../reports/report-types.js";
import { assertReportProjectRequirement } from "../reports/report-access.js";
import { resolveSceneRuntime } from "./ai-runtime.service.js";
import { AI_SCENES, AUDIT_ACTIONS } from "../../shared/constants.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import type { AgentToolName } from "./ai-capability-router.js";
import type { ConversationRow } from "./ai-context-builder.js";

export const TOOL_STATUS_LABELS: Record<AgentToolName, string> = {
  search_knowledge: "正在查询知识库…",
  get_project_context: "正在读取项目资料…",
  get_project_memory: "正在读取项目记忆…",
  thermal_calculate: "正在进行热工计算…",
  compare_solutions: "正在比较方案…",
  get_report_types: "正在读取报告类型…",
  generate_report_draft: "正在生成报告…"
};

const DEFAULT_TOOL_TIMEOUT_MS = 20_000;
const OUTPUT_STORE_LIMIT = 8_000;

function detectDuplicateFromCtx(ctx: ToolRuntimeContext, nextHash: string): boolean {
  if (ctx.recentToolHashes.length === 0) return false;
  let streak = 0;
  for (let i = ctx.recentToolHashes.length - 1; i >= 0; i -= 1) {
    if (ctx.recentToolHashes[i] === nextHash) streak += 1;
    else break;
  }
  return streak + 1 >= ctx.duplicateLimit;
}

export type AgentWaitSignal = {
  __agentSignal: "WAITING_USER_INPUT";
  prompt: string;
  options?: unknown[];
};

export function isAgentWaitSignal(value: unknown): value is AgentWaitSignal {
  return Boolean(value && typeof value === "object" && (value as AgentWaitSignal).__agentSignal === "WAITING_USER_INPUT");
}

export function hashToolInput(toolName: string, input: unknown): string {
  return createHash("sha256").update(`${toolName}:${stableStringify(input)}`).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function summarizeToolPayload(value: unknown, limit = OUTPUT_STORE_LIMIT): Record<string, unknown> {
  const json = typeof value === "object" && value !== null ? value as Record<string, unknown> : { value };
  const text = JSON.stringify(json);
  if (text.length <= limit) return json;
  return { truncated: true, preview: text.slice(0, limit) };
}

export interface ToolRuntimeContext {
  app: FastifyInstance;
  request: FastifyRequest;
  user: AuthUser;
  conversation: ConversationRow;
  assistantMessageId: string;
  agentRunId: string;
  abortSignal: AbortSignal;
  recentToolHashes: string[];
  toolCallCount: { value: number };
  maxToolCalls: number;
  duplicateLimit: number;
  onWait?: (signal: AgentWaitSignal) => void;
  onEvent?: (event: string, data: unknown) => void;
}

const reportDraftOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  projectOverview: z.object({
    name: z.string(),
    region: z.string().nullable(),
    buildingType: z.string().nullable()
  }),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string(),
    citations: z.array(z.object({ sourceTitle: z.string(), page: z.number().int().positive().nullable() }))
  })),
  risks: z.array(z.string()),
  disclaimer: z.string()
});

const compareSolutionsSchema = withCandidateQueryRefines(z.object({
  ...thermalCandidateQueryFields,
  competitorCategory: z.string().trim().min(1).max(40).optional()
}));

async function persistToolCall(
  ctx: ToolRuntimeContext,
  input: {
    toolName: string;
    args: Record<string, unknown>;
    output: unknown;
    success: boolean;
    errorMessage?: string;
    durationMs: number;
  }
) {
  await ctx.app.db.insert(aiToolCalls).values({
    conversationId: ctx.conversation.id,
    messageId: ctx.assistantMessageId,
    agentRunId: ctx.agentRunId,
    toolName: input.toolName,
    inputJson: summarizeToolPayload(input.args),
    outputJson: summarizeToolPayload(input.output),
    inputHash: hashToolInput(input.toolName, input.args),
    success: input.success,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs
  });
}

function wrapExecute<T extends z.ZodType>(
  name: AgentToolName,
  schema: T,
  execute: (args: z.infer<T>, ctx: ToolRuntimeContext) => Promise<unknown>,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS
) {
  return async (raw: unknown, ctx: ToolRuntimeContext) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join("；") || "工具参数无效";
      await persistToolCall(ctx, {
        toolName: name,
        args: typeof raw === "object" && raw ? raw as Record<string, unknown> : { raw },
        output: { error: message },
        success: false,
        errorMessage: message,
        durationMs: 0
      });
      return { ok: false, error: message };
    }
    ctx.onEvent?.("tool_start", { toolName: name, message: TOOL_STATUS_LABELS[name] });
    ctx.onEvent?.("agent_status", { toolName: name, message: TOOL_STATUS_LABELS[name] });
    const hash = hashToolInput(name, parsed.data);
    if (detectDuplicateFromCtx(ctx, hash)) {
      throw new AiError("AGENT_LOOP_LIMIT");
    }
    if (ctx.toolCallCount.value >= ctx.maxToolCalls) {
      throw new AiError("AGENT_LOOP_LIMIT");
    }
    ctx.recentToolHashes.push(hash);
    ctx.toolCallCount.value += 1;
    const started = Date.now();
    const timeout = AbortSignal.timeout(timeoutMs);
    const linked = AbortSignal.any([ctx.abortSignal, timeout]);
    try {
      if (linked.aborted) throw new AiError("AGENT_TOOL_TIMEOUT");
      const output = await Promise.race([
        execute(parsed.data, ctx),
        new Promise<never>((_, reject) => {
          linked.addEventListener("abort", () => {
            reject(new AiError(ctx.abortSignal.aborted ? "AGENT_CANCELLED" : "AGENT_TOOL_TIMEOUT"));
          }, { once: true });
        })
      ]);
      if (isAgentWaitSignal(output)) ctx.onWait?.(output);
      await persistToolCall(ctx, {
        toolName: name,
        args: parsed.data as Record<string, unknown>,
        output,
        success: true,
        durationMs: Date.now() - started
      });
      ctx.onEvent?.("tool_result", { toolName: name, success: true });
      return output;
    } catch (error) {
      const aiError = error instanceof AiError ? error : new AiError("AI_PROVIDER_UNAVAILABLE", error instanceof Error ? error.message : "工具执行失败");
      await persistToolCall(ctx, {
        toolName: name,
        args: parsed.data as Record<string, unknown>,
        output: { error: aiError.message },
        success: false,
        errorMessage: aiError.message,
        durationMs: Date.now() - started
      });
      ctx.onEvent?.("tool_result", { toolName: name, success: false, error: aiError.message });
      throw error;
    }
  };
}

const searchKnowledgeSchema = z.object({
  query: z.string().trim().min(1).max(500)
});

const emptySchema = z.object({});

const generateReportSchema = z.object({
  reportType: z.string().trim().min(1).max(80),
  requirements: z.string().trim().max(4000).optional()
});

export function createAgentTools(ctx: ToolRuntimeContext, allowed: AgentToolName[]) {
  const executors: Record<AgentToolName, ReturnType<typeof wrapExecute>> = {
    search_knowledge: wrapExecute("search_knowledge", searchKnowledgeSchema, async ({ query }) => {
      const { chunks, retrievalFailed } = await loadKnowledgeForGeneration({
        app: ctx.app,
        log: ctx.request.log,
        conversationId: ctx.conversation.id,
        messageId: ctx.assistantMessageId,
        content: query,
        projectId: ctx.conversation.projectId,
        insulationSystemId: ctx.conversation.insulationSystemId ?? null,
        needSearch: true
      });
      const sources = toAiSources(chunks).map((source) => ({
        documentId: source.documentId,
        versionId: source.versionId,
        title: source.title,
        tocPath: source.tocPath,
        sectionTitle: source.sectionTitle,
        pageLabel: source.pageLabel,
        physicalPageNumber: source.physicalPageNumber,
        quote: source.quote
      }));
      ctx.onEvent?.("sources", { sources: toAiSources(chunks) });
      return {
        context: formatKnowledgeContext(chunks, { retrievalFailed }),
        sources,
        retrievalFailed
      };
    }),
    get_project_context: wrapExecute("get_project_context", emptySchema, async () => {
      if (!ctx.conversation.projectId) {
        return { context: null, note: "当前会话未关联项目" };
      }
      const context = await resolveProjectContext(ctx.app, ctx.conversation.projectId);
      return { projectId: ctx.conversation.projectId, context };
    }),
    get_project_memory: wrapExecute("get_project_memory", emptySchema, async () => {
      if (!ctx.conversation.projectId) {
        return { memories: [], note: "当前会话未关联项目" };
      }
      const memories = await listInjectableProjectMemories(ctx.app, ctx.conversation.projectId);
      return {
        memories,
        context: formatProjectMemoryContext(memories)
      };
    }),
    thermal_calculate: wrapExecute("thermal_calculate", thermalCalcRequestSchema, async (args) => {
      const result = await executeThermalCalc(ctx.app, ctx.request, ctx.user, {
        ...args,
        projectId: ctx.conversation.projectId ?? args.projectId ?? null
      });
      const record = result.record;
      const calcResult = (record?.result ?? {}) as Record<string, unknown>;
      return {
        valid: result.valid,
        errors: result.errors,
        notes: result.notes,
        input: args,
        process: record?.steps ?? [],
        R: calcResult.totalResistanceRounded ?? calcResult.totalResistance ?? null,
        K: calcResult.kValueRounded ?? calcResult.kValue ?? null,
        target: (record?.standard as Record<string, unknown> | null)?.limitKValue ?? null,
        pass: (calcResult.compliant as boolean | null | undefined) ?? null,
        basis: record?.rule ?? record?.standard ?? null,
        source: record ? { recordId: record.id, mode: record.mode } : null
      };
    }),
    compare_solutions: wrapExecute("compare_solutions", compareSolutionsSchema, async (args) => {
      const { competitorCategory, ...candidateQuery } = args;
      const outcome = await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
        ...candidateQuery,
        systemId: candidateQuery.systemId ?? ctx.conversation.insulationSystemId ?? undefined,
        neighborTolerance: candidateQuery.neighborTolerance ?? 1
      });
      const rules = competitorCategory
        ? await loadApprovedComparisonRules(ctx.app, { competitorCategory, limit: 12 })
        : [];
      const candidates = outcome.candidates.slice(0, 8).map((item) => ({
        candidateId: item.candidateId,
        matchType: item.matchType,
        matchedConditions: item.matchedConditions,
        unmatchedConditions: item.unmatchedConditions,
        missingConditions: item.missingConditions,
        compliant: item.compliant,
        ranking: item.ranking,
        scheme: item.scheme,
        kValue: item.result.kValue,
        thicknessMm: item.result.thicknessMm
      }));
      const needsChoice = candidates.length > 1 || Boolean(outcome.limitCandidates && outcome.limitCandidates.length > 1);
      const payload = {
        candidates,
        missingConditions: outcome.missingConditions,
        notes: outcome.notes,
        limitCandidates: outcome.limitCandidates,
        comparisonRules: rules.map((rule) => ({
          dimensionName: rule.dimensionName,
          advantageText: rule.advantageText,
          applicability: rule.applicability,
          vicpValue: rule.vicpValue,
          competitorValue: rule.competitorValue
        })),
        choiceRequired: needsChoice,
        disclaimer: "以上为多个候选及差异，不代表唯一最终选择，须由用户确认。"
      };
      if (needsChoice) {
        return {
          ...payload,
          __agentSignal: "WAITING_USER_INPUT" as const,
          prompt: "请从候选方案中选择一个，或补充缺失条件后继续。",
          options: candidates.map((item, index) => ({
            index: index + 1,
            candidateId: item.candidateId,
            scheme: item.scheme,
            kValue: item.kValue
          }))
        };
      }
      return payload;
    }),
    get_report_types: wrapExecute("get_report_types", emptySchema, async () => ({
      items: listPublicReportTypes()
    })),
    generate_report_draft: wrapExecute("generate_report_draft", generateReportSchema, async ({ reportType, requirements }) => {
      const definition = resolveReportType(reportType);
      const projectId = ctx.conversation.projectId ?? null;
      try {
        assertReportProjectRequirement({ requiresProject: definition.requiresProject, projectId });
      } catch (error) {
        if (error instanceof ReportError) {
          return { ok: false, error: error.message, code: error.code };
        }
        throw error;
      }
      const runtime = await resolveSceneRuntime(ctx.app.db, AI_SCENES.REPORT_GENERATE, "OFF");
      const history = await ctx.app.db.select({ role: aiMessages.role, content: aiMessages.content })
        .from(aiMessages).where(eq(aiMessages.conversationId, ctx.conversation.id));
      const result = await generateObject({
        model: runtime.primary.languageModel,
        schema: reportDraftOutputSchema,
        system: "请生成结构化中文报告草稿。所有技术结论必须来自会话中的资料、工具结果或明确标注待复核。",
        prompt: `报告类型：${reportType}\n补充要求：${requirements ?? "无"}\n会话材料：\n${history.map((item) => `${item.role}：${item.content}`).join("\n").slice(0, 12000)}`,
        maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? 4000,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(runtime.primary.timeoutMs)
      });
      const [report] = await ctx.app.db.insert(reports).values({
        projectId,
        conversationId: ctx.conversation.id,
        reportType,
        status: "DRAFT",
        contentJson: result.object,
        promptTemplateVersion: runtime.promptVersionNumber,
        createdById: ctx.user.id
      }).returning();
      if (ctx.request) {
        await writeAuditLog({
          db: ctx.app.db, request: ctx.request, actor: ctx.user, projectId: projectId ?? undefined,
          action: AUDIT_ACTIONS.REPORT_GENERATED, targetType: "report", targetId: report!.id,
          afterJson: { status: "DRAFT", source: "agent_tool" }
        });
      }
      return { ok: true, reportId: report!.id, draft: result.object };
    }, 60_000)
  };

  const selected: Record<string, ReturnType<typeof tool>> = {};
  for (const name of allowed) {
    const description = {
      search_knowledge: "检索已发布且当前用户有权访问的知识资料（图集/标准/构造）。只返回 PUBLISHED + AI_ENABLED 来源。",
      get_project_context: "读取当前会话关联项目的结构化档案（名称/地区/建筑类型）。",
      get_project_memory: "读取当前项目已确认的长期记忆，不含未核实假设。",
      thermal_calculate: "调用系统确定性热工计算引擎，禁止自行估算 K/R。",
      compare_solutions: "查询多个候选方案及差异，不得替用户做唯一最终选择。",
      get_report_types: "列出可生成的报告类型及是否必须关联项目。",
      generate_report_draft: "仅在用户明确要求生成报告时调用，生成结构化报告草稿。"
    }[name];
    const schemas: Record<AgentToolName, z.ZodType> = {
      search_knowledge: searchKnowledgeSchema,
      get_project_context: emptySchema,
      get_project_memory: emptySchema,
      thermal_calculate: thermalCalcRequestSchema,
      compare_solutions: compareSolutionsSchema,
      get_report_types: emptySchema,
      generate_report_draft: generateReportSchema
    };
    selected[name] = tool({
      description,
      inputSchema: schemas[name] as z.ZodType<unknown>,
      execute: async (args: unknown) => executors[name](args, ctx)
    }) as never;
  }
  return selected;
}
