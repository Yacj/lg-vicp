import { tool } from "ai";
import { z } from "zod";
import { executeThermalCalc } from "../../thermal/thermal-calc.service.js";
import { thermalCalcModeSchema } from "../../thermal/thermal-calc.schemas.js";
import { queryThermalCandidates } from "../../thermal/thermal-candidate.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolError, toolOk } from "./tool-output.js";
import { buildReferencePageBlocks, REFERENCE_PAGE_MISSING_NOTE, type ReferencePageCandidate } from "../reference-page.js";
import { knowledgeDocuments, knowledgePages } from "../../../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { normalizeReferenceLookupForModel, normalizeThermalForModel } from "./tool-result-normalizer.js";
import {
  compactCandidateResults,
  filterCandidatesBySystemHint,
  filterReusableCandidates,
  inheritLookupQuery
} from "./thermal-lookup.js";
import { parseConversationTaskState, mergeConversationTaskState, type LastReferenceLookup } from "../conversation-task.js";
import { saveConversationTaskState } from "../ai-conversation-state.service.js";

const specClassSchema = z.enum(["I", "II", "III"]);

/**
 * 单一 object + superRefine，禁止 discriminatedUnion。
 * OpenAI 兼容网关（含 DeepSeek）对 oneOf/anyOf Tool JSON Schema 经常卡住或死循环重试。
 */
export const thermalInput = z.object({
  operation: z.enum(["LOOKUP_CANDIDATES", "CALCULATE"])
    .describe("查已有参考档位用 LOOKUP_CANDIDATES；对已确定方案/规格/厚度做正式计算用 CALCULATE"),
  targetK: z.number().positive().max(10).optional()
    .describe("目标传热系数；查询已有参考档位时有此值即可开始，不要因此追问地区"),
  targetR: z.number().positive().max(100).optional()
    .describe("目标总热阻。查表时使用，不因此进入正式计算"),
  systemHint: z.string().trim().min(1).max(80).optional()
    .describe("用户提到的保温体系提示，例如薄抹灰；不是 UUID"),
  specClass: specClassSchema.optional()
    .describe("I / II / III 型；用户说Ⅱ型时传 II"),
  mode: thermalCalcModeSchema.optional()
    .describe("REFERENCE_TABLE 图集查表，EQUIVALENT 整体当量，LAYERED 分层法；仅 CALCULATE 需要"),
  schemeId: z.uuid("构造方案 ID 格式不正确").optional()
    .describe("已发布构造方案 ID；仅 CALCULATE 需要"),
  productSpecId: z.uuid("产品规格 ID 格式不正确").optional()
    .describe("已发布产品规格 ID；仅 CALCULATE 需要"),
  thicknessMm: z.coerce.number().positive().max(100000).optional()
    .describe("保温厚度 mm。查表时用于匹配参考行；正式计算时必须落在方案产品选项区间内"),
  regionCode: z.string().trim().min(1).max(40).optional()
    .describe("标准限值地区编码；缺省不判定是否达标"),
  ruleCode: z.string().trim().min(1).max(80).optional()
    .describe("计算规则编码；缺省取最新已发布规则")
}).superRefine((data, ctx) => {
  if (data.operation !== "CALCULATE") return;
  if (!data.mode) {
    ctx.addIssue({ code: "custom", path: ["mode"], message: "正式计算必须指定计算模式" });
  }
  if (!data.schemeId) {
    ctx.addIssue({ code: "custom", path: ["schemeId"], message: "正式计算必须指定构造方案" });
  }
  if (!data.productSpecId) {
    ctx.addIssue({ code: "custom", path: ["productSpecId"], message: "正式计算必须指定产品规格" });
  }
  if (data.thicknessMm == null) {
    ctx.addIssue({ code: "custom", path: ["thicknessMm"], message: "正式计算必须指定保温厚度" });
  }
});

export const thermalLookupInput = thermalInput;
export const thermalCalculateOpInput = thermalInput;
/** 兼容旧测试名 */
export const thermalCalculateInput = thermalInput;

function summarizeProcess(steps: unknown): Array<{ title?: string; formula?: string; value?: unknown }> {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 24).map((step) => {
    if (!step || typeof step !== "object") return { title: String(step) };
    const record = step as Record<string, unknown>;
    return {
      title: typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : undefined,
      formula: typeof record.formula === "string" ? record.formula : undefined,
      value: record.value ?? record.result ?? record.output
    };
  });
}

async function persistLastReferenceLookup(ctx: ToolRuntimeContext, snapshot: LastReferenceLookup) {
  const taskState = mergeConversationTaskState(ctx.taskState ?? parseConversationTaskState(null), {
    lastReferenceLookup: snapshot
  });
  if (ctx.taskState) ctx.taskState.lastReferenceLookup = snapshot;
  await saveConversationTaskState(ctx.app, ctx.conversation.id, taskState);
}

export function createThermalTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      热工能力。LOOKUP_CANDIDATES：按目标 K / 体系提示查询已发布图集参考档位，不要要求地区、气候区、基层或建筑类型；未命中时必须再检索知识库，不要对用户说没有方案。
      CALCULATE：对已确定的方案、规格和厚度做正式确定性计算；合规判断才需要地区。
      项目归属以当前会话为准，不要传入 projectId。
    `,
    inputSchema: thermalInput,
    execute: async (args, options) => {
      const statusMessage = args.operation === "LOOKUP_CANDIDATES"
        ? "正在查询已发布参考方案…"
        : "正在进行热工计算…";
      return runRegisteredTool(ctx, "thermal", args, {
        toolCallId: options.toolCallId,
        abortSignal: options.abortSignal,
        statusMessage
      }, async () => {
        if (args.operation === "CALCULATE" && ctx.answerContract === "REFERENCE_LOOKUP") {
          return toolError({
            code: "REFERENCE_LOOKUP_ONLY",
            message: "当前是查询已有参考方案，请改用 LOOKUP_CANDIDATES，不要做正式热工计算"
          });
        }
        if (args.operation !== "CALCULATE") {
          const last = ctx.taskState?.lastReferenceLookup;
          const inherited = inheritLookupQuery({
            targetK: args.targetK,
            targetR: args.targetR,
            thicknessMm: args.thicknessMm,
            systemHint: args.systemHint,
            specClass: args.specClass
          }, last);
          const reusable = filterReusableCandidates(last, {
            targetK: inherited.targetK,
            targetR: inherited.targetR,
            thicknessMm: inherited.thicknessMm,
            specClass: inherited.specClass,
            systemHint: inherited.systemHint
          });
          let candidates = reusable;
          let notes: string[] = [];
          if (!candidates) {
            const outcome = await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
              targetK: inherited.targetK,
              targetResistance: inherited.targetR,
              thicknessMm: inherited.thicknessMm,
              specClass: inherited.specClass,
              neighborTolerance: 1,
              projectId: ctx.conversation.projectId ?? undefined
            });
            candidates = filterCandidatesBySystemHint(
              compactCandidateResults(outcome.candidates),
              inherited.systemHint
            );
            notes = outcome.notes;
          }
          if (candidates.length === 0) {
            notes = [...notes, "选用表未命中不等于知识库没有该方案，请继续检索图集原文"];
          }
          if (candidates.length > 0) {
            const snapshot: LastReferenceLookup = {
              query: {
                targetK: inherited.targetK,
                targetR: inherited.targetR,
                thicknessMm: inherited.thicknessMm,
                systemHint: inherited.systemHint,
                specClass: inherited.specClass
              },
              candidates,
              createdAt: new Date().toISOString()
            };
            await persistLastReferenceLookup(ctx, snapshot);
          }
          const pageOutcome = await emitReferencePages(ctx, candidates);
          if (pageOutcome.missingPage && candidates.length > 0) {
            notes = [...notes, REFERENCE_PAGE_MISSING_NOTE];
          }
          const data = normalizeReferenceLookupForModel({
            found: candidates.length > 0,
            candidates,
            notes
          });
          return toolOk(data, {
            summary: candidates.length > 0
              ? `找到 ${candidates.length} 条接近目标的已发布参考档位`
              : "选用表未命中，需继续检索知识库图集",
            ...(pageOutcome.sources.length > 0 ? { sources: pageOutcome.sources } : {})
          });
        }

        if (!args.mode || !args.schemeId || !args.productSpecId || args.thicknessMm == null) {
          throw new Error("正式热工计算缺少方案、规格或厚度");
        }
        const result = await executeThermalCalc(ctx.app, ctx.request, ctx.user, {
          mode: args.mode,
          schemeId: args.schemeId,
          productSpecId: args.productSpecId,
          thicknessMm: args.thicknessMm,
          regionCode: args.regionCode,
          ruleCode: args.ruleCode,
          projectId: ctx.conversation.projectId ?? null
        });
        const record = result.record;
        const calcResult = (record?.result ?? {}) as Record<string, unknown>;
        const data = normalizeThermalForModel({
          valid: result.valid,
          K: calcResult.kValueRounded ?? calcResult.kValue ?? null,
          R: calcResult.totalResistanceRounded ?? calcResult.totalResistance ?? null,
          pass: (calcResult.compliant as boolean | null | undefined) ?? null,
          notes: result.notes,
          errors: result.errors,
          process: summarizeProcess(record?.steps)
        });
        return toolOk(data, {
          summary: result.valid
            ? `K=${String(data.K)} R=${String(data.R)}`
            : (data.notes[0] ?? "热工计算未完成")
        });
      });
    }
  });
}

async function emitReferencePages(
  ctx: ToolRuntimeContext,
  candidates: Array<{
    id: string;
    systemName?: string;
    schemeCode?: string;
    thicknessMm?: number;
    productThermalResistance?: number;
    totalThermalResistance?: number;
    kValue?: number;
    sourceDocumentId?: string | null;
    sourcePageId?: string | null;
    sourcePageLabel?: string | null;
  }>
) {
  const pageIds = [...new Set(candidates.map((item) => item.sourcePageId).filter((id): id is string => Boolean(id)))];
  if (pageIds.length === 0) return { missingPage: candidates.length > 0, sources: [] as unknown[] };
  const rows = await ctx.app.db.select({
    pageId: knowledgePages.id,
    documentId: knowledgePages.documentId,
    documentTitle: knowledgeDocuments.title,
    pageNumber: knowledgePages.pageNumber,
    physicalPageNumber: knowledgePages.physicalPageNumber,
    pageLabel: knowledgePages.pageLabel,
    pageImageObjectKey: knowledgePages.pageImageObjectKey
  }).from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .where(inArray(knowledgePages.id, pageIds));
  const pages = await Promise.all(rows.map(async (row) => {
    const physicalPageNumber = row.physicalPageNumber ?? row.pageNumber;
    return {
      pageId: row.pageId,
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      pageNumber: physicalPageNumber,
      physicalPageNumber,
      pageLabel: row.pageLabel,
      pageImageObjectKey: row.pageImageObjectKey,
      imageUrl: row.pageImageObjectKey
        ? await ctx.app.storage.createDownloadUrl(row.pageImageObjectKey, `page-${physicalPageNumber}.png`, 3600)
        : null
    };
  }));
  const built = buildReferencePageBlocks(candidates as ReferencePageCandidate[], pages);
  if (built.blocks.length > 0) {
    ctx.onEvent?.("reference_pages", { referencePages: built.blocks, stored: built.stored });
    const sources = built.blocks.map((block) => ({
      documentId: block.page.documentId,
      pageId: block.page.pageId,
      title: block.page.documentTitle,
      pageLabel: block.page.pageLabel,
      pageNumber: block.page.pageNumber,
      physicalPageNumber: block.page.physicalPageNumber ?? block.page.pageNumber
    }));
    ctx.onEvent?.("sources", { sources });
    return { missingPage: false, sources };
  }
  return { missingPage: true, sources: [] as unknown[] };
}

/** 兼容旧导出名 */
export const createThermalCalculateTool = createThermalTool;
