import { resolveScopedThermalStandard } from "../../thermal/thermal-standard-scope.service.js";
import { isThermalComplianceIntent } from "../../../shared/ai-answer-contract.js";
import { loadThermalQueryDictionary } from "../../thermal/thermal-query-dictionary.service.js";
import { queryStateExtraFields, validateCandidateAgainstQueryState, rankByPreferences, traceQueryState, type ConstraintMatch, type ThermalQueryState } from "../../thermal/thermal-query-state.js";
import { buildThermalQueryDebug, logThermalQueryDebug, toRejectedCandidateDebug, type ThermalQueryDebugSnapshot } from "../../thermal/thermal-query-debug.js";
import { buildAllowedAnswerFacts, buildCalculationAnswer, renderClarification, setThermalAnswerFacts } from "../thermal-answer-validation.js";
import { buildThermalCalcPresentation } from "../../thermal/thermal-calc-presentation.js";
import { tool } from "ai";
import { z } from "zod";
import { executeThermalCalc } from "../../thermal/thermal-calc.service.js";
import { thermalCalcModeSchema } from "../../thermal/thermal-calc.schemas.js";
import { thermalLookupFilterSchema } from "../../thermal/thermal-lookup.schemas.js";
import { formatLookupThickness } from "../../thermal/thermal-lookup-thickness.js";
import { queryThermalCandidates } from "../../thermal/thermal-candidate.service.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolError, toolOk } from "./tool-output.js";
import { buildReferencePageBlocks, REFERENCE_PAGE_MISSING_NOTE, type ReferencePageCandidate } from "../reference-page.js";
import { knowledgeDocumentVersions, knowledgeDocuments, knowledgePages } from "../../../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { normalizeReferenceLookupForModel, normalizeThermalForModel } from "./tool-result-normalizer.js";
import {
  compactCandidateResult,
  filterReusableCandidates,
  normalizeConversationLookupQuery,
  LOOKUP_LIMIT
} from "./thermal-lookup.js";
import {
  resolveMetricTolerance,
  TOLERANCE_ADJUSTED_NOTE,
  THERMAL_LOOKUP_METRICS,
  type ThermalLookupMode
} from "../../thermal/thermal-lookup-mode.js";
import { parseConversationTaskState, mergeConversationTaskState, type LastReferenceLookup } from "../conversation-task.js";
import { saveConversationTaskState } from "../ai-conversation-state.service.js";
import { bindConfirmedPageFacts, interpretThermalQuestion, thermalMetricClarification, THERMAL_FACT_RULES } from "../thermal-answer-facts.js";
import type { ReferenceLookupCandidate } from "../conversation-task.js";

const { conditionTrace: _trace, unresolved: _unresolved, removedFields: _removed, removedMetrics: _removedMetrics, ...thermalConstraintInputFields } = queryStateExtraFields;

const specClassSchema = z.enum(["I", "II", "III"]);

/**
 * 单一 object + superRefine，禁止 discriminatedUnion。
 * OpenAI 兼容网关（含 DeepSeek）对 oneOf/anyOf Tool JSON Schema 经常卡住或死循环重试。
 */
export const thermalInput = z.object({
  ...thermalConstraintInputFields,
  filters: z.array(thermalLookupFilterSchema).min(1).max(12).optional().describe("多个热工指标条件，默认全部同时满足（AND）；不得只传其中一项"),
  metric: z.enum(THERMAL_LOOKUP_METRICS).optional().describe("查表指标：K 传热系数，TOTAL_R 总热阻，PRODUCT_R 产品层热阻"),
  targetValue: z.number().positive().max(100).optional().describe("查表指标目标值，与 metric 配合使用"),
  tolerance: z.number().positive().max(100).optional().describe("仅用户明确给出±或上下误差时传入；后端从用户原话提取并限制，模型值不直接生效"),
  operation: z.enum(["LOOKUP_CANDIDATES", "CALCULATE"])
    .describe("查已有参考档位用 LOOKUP_CANDIDATES；对已确定方案/规格/厚度做正式计算用 CALCULATE"),
  targetK: z.number().positive().max(10).optional()
    .describe("deprecated：兼容目标 K，优先使用 metric=K + targetValue"),
  targetR: z.number().positive().max(100).optional()
    .describe("deprecated：兼容目标总热阻，优先使用 metric=TOTAL_R + targetValue"),
  systemHint: z.string().trim().min(1).max(80).optional()
    .describe("用户提到的保温体系提示，例如薄抹灰；不是 UUID"),
  specClass: specClassSchema.optional()
    .describe("I / II / III 型；用户说Ⅱ型时传 II"),
  systemId: z.uuid("保温体系 ID 格式不正确").optional().describe("已知的正式保温体系 ID，优先于名称提示"),
  schemeCode: z.string().trim().min(1).max(80).optional().describe("查询指定构造方案编码"),
  catalogProductId: z.uuid("产品目录 ID 格式不正确").optional().describe("查询指定产品目录"),
  lookupMode: z.enum(["APPROX", "MAX_LIMIT", "MIN_LIMIT", "EXACT"]).optional()
    .describe(
      "查询已有参考档位时的指标语义（K / 总热阻 / 产品层热阻共用），必须与用户原话一致："
      + "「0.3左右 / 接近0.3 / 约0.3 / 0.3的方案有么 / 有没有0.3附近的」用 APPROX；"
      + "「不超过0.3 / 0.3以内 / K≤0.3 / 最大0.3 / 上限0.3 / 是否满足0.3限值」用 MAX_LIMIT；"
      + "「不低于0.3 / K≥0.3 / 至少0.3」用 MIN_LIMIT；「正好等于0.303」用 EXACT。"
      + "用户本轮明确语义优先于本参数；缺省先按原话推断，无新语义则继承上轮，首轮默认 APPROX。"
    ),
  kTolerance: z.number().positive().max(5).optional()
    .describe("K 容差（仅 APPROX/EXACT 生效）；一般不要传，由后端使用固定业务默认值"),
  mode: thermalCalcModeSchema.optional()
    .describe("REFERENCE_TABLE 图集查表，EQUIVALENT 整体当量，LAYERED 分层法；仅 CALCULATE 需要"),
  schemeId: z.uuid("构造方案 ID 格式不正确").optional()
    .describe("已发布构造方案 ID；查询时可限定方案，CALCULATE 必填"),
  productSpecId: z.uuid("产品规格 ID 格式不正确").optional()
    .describe("已发布产品规格 ID；查询时可限定规格，CALCULATE 必填"),
  thicknessMm: z.coerce.number().positive().max(100000).optional()
    .describe("保温厚度 mm。查表时用于匹配参考行；正式计算时必须落在方案产品选项区间内"),
  thicknessMin: z.coerce.number().positive().max(1000).optional().describe("查表最小保温厚度 mm，与精确厚度互斥"),
  thicknessMax: z.coerce.number().positive().max(1000).optional().describe("查表最大保温厚度 mm；20mm以内传此字段，不能传精确厚度"),
  regionCode: z.string().trim().min(1).max(40).optional()
    .describe("标准限值地区编码；缺省不判定是否达标"),
  ruleCode: z.string().trim().min(1).max(80).optional()
    .describe("计算规则编码；缺省取最新已发布规则")
}).superRefine((data, ctx) => {
  if (data.operation === "LOOKUP_CANDIDATES") {
    if (data.thicknessMm !== undefined && (data.thicknessMin !== undefined || data.thicknessMax !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["thicknessMm"], message: "精确厚度与厚度范围不能同时提供" });
    }
    if (data.thicknessMin !== undefined && data.thicknessMax !== undefined && data.thicknessMin > data.thicknessMax) {
      ctx.addIssue({ code: "custom", path: ["thicknessMin"], message: "厚度范围下限不能大于上限" });
    }
  }
  if (data.operation === "LOOKUP_CANDIDATES" && (data.metric === undefined) !== (data.targetValue === undefined)) {
    ctx.addIssue({ code: "custom", path: ["targetValue"], message: "metric 与 targetValue 必须同时提供" });
  }
  if (data.metric === "K" && data.targetValue != null && data.targetValue > 10) {
    ctx.addIssue({ code: "custom", path: ["targetValue"], message: "目标 K 不能超过 10" });
  }
  if (data.operation !== "CALCULATE") return;
  if (!data.mode) {
    ctx.addIssue({ code: "custom", path: ["mode"], message: "正式计算必须指定计算模式" });
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
  else ctx.taskState = taskState;
  await saveConversationTaskState(ctx.app, ctx.conversation.id, taskState);
}

export function createThermalTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      热工能力。LOOKUP_CANDIDATES：按传热系数 K / 总热阻 TOTAL_R / 产品层热阻 PRODUCT_R 和体系提示查询已发布图集参考档位，不要要求地区、气候区、基层或建筑类型；未命中时必须再检索知识库，不得把选用表未命中说成整个资料库没有方案。跨体系回退必须先说明没有找到指定体系的正式参考方案。传热阻系数含义不明时澄清是传热系数K还是总热阻R；模型不能决定容差。
      查询时必须区分 K 语义：用户说「0.3左右 / 接近0.3 / 0.3的方案有么」是近似查询（lookupMode=APPROX，0.303 也应返回）；只有用户明确说「不超过 / 以内 / ≤ / 最大 / 上限 / 限值」才是上限查询（lookupMode=MAX_LIMIT）。
      多轮仅更新用户明确改变的指标，保留其他条件；取消条件从用户原话识别。厚度18mm是精确档，20mm以内用thicknessMax，18mm以上用thicknessMin，18～25mm同时传上下限。尽量薄不猜数字，在满足硬条件后按厚度升序展示。
      CALCULATE：对已确定的方案、规格和厚度做正式确定性计算；合规判断才需要地区。
      项目归属以当前会话为准，不要传入 projectId。
      ${THERMAL_FACT_RULES}
    `,
    inputSchema: thermalInput,
    execute: async (args, options) => {
      // 每次调用单独保存审计，避免同Step并行工具共享上下文时相互污染。
      let lookupDecision: Record<string, unknown> | undefined;
      const statusMessage = args.operation === "LOOKUP_CANDIDATES"
        ? "正在查询已发布参考方案…"
        : "正在进行热工计算…";
      return runRegisteredTool(ctx, "thermal", args, {
        toolCallId: options.toolCallId,
        abortSignal: options.abortSignal,
        statusMessage,
        auditMetadata: () => lookupDecision ? { backendDecision: lookupDecision } : {}
      }, async () => {
        if (args.operation === "CALCULATE" && ctx.answerContract === "REFERENCE_LOOKUP") {
          return toolError({
            code: "REFERENCE_LOOKUP_ONLY",
            message: "当前是查询已有参考方案，请改用 LOOKUP_CANDIDATES，不要做正式热工计算"
          });
        }
        if (args.operation !== "CALCULATE") {
          const last = ctx.taskState?.lastReferenceLookup;
          const dictionary = await loadThermalQueryDictionary(ctx.app.db);
          if (interpretThermalQuestion(ctx.userMessage ?? "", last?.query.metric).needsClarification) {
            const parsed = normalizeConversationLookupQuery({ ...args, filters: undefined, metric: undefined, targetValue: undefined,
              targetK: undefined, targetR: undefined, mode: undefined }, ctx.userMessage ?? "", last, dictionary);
            const query = traceQueryState({ ...parsed.query, unresolved: [...(parsed.query.unresolved ?? []),
              { field: "metric", reason: "请确认保温板自身的产品层热阻 R、整墙总热阻 R₀ 或传热系数 K。" }] }, last?.query);
            await persistLastReferenceLookup(ctx, { query, candidates: [], createdAt: new Date().toISOString() });
            setThermalAnswerFacts(ctx, buildAllowedAnswerFacts(query, [], ctx.userMessage ?? ""));
            return toolOk(thermalMetricClarification());
          }
          const resolution = normalizeConversationLookupQuery({
            ...args,
            systemId: args.systemId ?? ctx.conversation.insulationSystemId ?? undefined,
            filters: args.filters,
            metric: args.metric,
            targetValue: args.targetValue,
            schemeId: args.schemeId,
            schemeCode: args.schemeCode,
            productSpecId: args.productSpecId,
            catalogProductId: args.catalogProductId,
            targetK: args.targetK,
            targetR: args.targetR,
            thicknessMm: args.thicknessMm,
            thicknessMin: args.thicknessMin,
            thicknessMax: args.thicknessMax,
            systemHint: args.systemHint,
            specClass: args.specClass,
            mode: args.lookupMode,
            tolerance: args.tolerance ?? args.kTolerance
          }, ctx.userMessage ?? "", last, dictionary);
          if (resolution.needsClarification || resolution.query.unresolved?.length) {
            const query = traceQueryState({ ...resolution.query, unresolved: [...(resolution.query.unresolved ?? []),
              ...(resolution.needsClarification && !resolution.query.unresolved?.length ? [{ field: "query", reason: "不明确的热工指标、目标值、厚度或多条件关系。" }] : [])] }, last?.query);
            await persistLastReferenceLookup(ctx, { query, candidates: [], createdAt: new Date().toISOString() });
            setThermalAnswerFacts(ctx, buildAllowedAnswerFacts(query, [], ctx.userMessage ?? ""));
            return toolOk({ needsClarification: true, instruction: "请用一个短问题确认不明确的热工指标、目标值及多条件关系；已明确的条件全部保留，禁止只取一项或猜测工程指标。" });
          }
          let inherited: ThermalQueryState = { ...resolution.query, intent: "REFERENCE_LOOKUP" as const };
          const requestedMode = inherited.mode;
          if (resolution.conflict) {
            ctx.app.log.warn({ toolMode: args.lookupMode, resolvedMode: requestedMode }, "热工查询模式冲突：以用户明确语义为准");
          }
          // 只有纯参数/原页指代可复用；普通查询即使签名相同也重新读取正式发布状态。
          const attributeQuestion = resolution.attributeQuestion;
          const reusable = attributeQuestion ? filterReusableCandidates(last, inherited) : null;
          lookupDecision = {
            query: inherited,
            reusePreviousCandidate: reusable !== null,
            candidateIds: reusable?.map(candidate => candidate.id) ?? []
          };
          let candidates = reusable;
          let nearbyFacts: ReferenceLookupCandidate[] = [];
          let notes: string[] = [];
          let effectiveMode: ThermalLookupMode = inherited.mode ?? requestedMode ?? "APPROX";
          let effectiveTolerance: number | null = inherited.metric ? resolveMetricTolerance(inherited.metric, effectiveMode, inherited.tolerance) ?? null : null;
          let matchedSystemHint: boolean | null = reusable ? last?.matchedSystemHint ?? null : inherited.systemHint ? true : null;
          let isFallback = reusable ? last?.isFallback ?? false : false;
          if (!candidates) {
            const outcome = await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
              ...inherited,
              filters: inherited.filters?.length ? inherited.filters : undefined,
              metric: inherited.metric,
              targetValue: inherited.targetValue,
              mode: effectiveMode,
              tolerance: inherited.tolerance,
              systemId: inherited.systemId,
              schemeId: inherited.schemeId,
              schemeCode: inherited.schemeCode,
              productSpecId: inherited.productSpecId,
              catalogProductId: inherited.catalogProductId,
              targetK: inherited.targetK,
              kMode: effectiveMode,
              kTolerance: inherited.tolerance,
              targetResistance: inherited.targetR,
              thicknessMm: inherited.thicknessMm,
              thicknessMin: inherited.thicknessMin,
              thicknessMax: inherited.thicknessMax,
              specClass: inherited.specClass,
              neighborTolerance: 1,
              projectId: ctx.conversation.projectId ?? undefined
            });
            effectiveMode = outcome.lookupMode;
            effectiveTolerance = outcome.tolerance ?? null;
            inherited = traceQueryState({ ...inherited, ...(outcome.queryState ?? {}) }, last?.query);
            const all = [...outcome.candidates, ...(outcome.nearbyCandidates ?? [])].map(compactCandidateResult);
            const validated = all.map(candidate => ({ ...candidate,
              constraintMatch: validateCandidateAgainstQueryState(candidate, inherited) }));
            candidates = rankByPreferences(validated.filter(candidate => candidate.constraintMatch.passed), inherited).slice(0, LOOKUP_LIMIT);
            nearbyFacts = validated.filter(candidate => !candidate.constraintMatch.passed).slice(0, LOOKUP_LIMIT);
            matchedSystemHint = inherited.systemHint ? candidates.length > 0 : null;
            isFallback = false;
            notes = outcome.notes;
            lookupDecision = { ...lookupDecision, query: inherited, matchedCount: validated.filter(candidate => candidate.constraintMatch.passed).length,
              stageCounts: outcome.stageCounts,
              candidateIds: candidates.map(candidate => candidate.id),
              nearbyCandidates: validated.filter(candidate => !candidate.constraintMatch.passed).map(candidate => ({ id: candidate.id, status: "NOT_FULLY_MATCHED", constraintMatch: candidate.constraintMatch })) };

          }
          if (candidates.length === 0) {
            const thicknessLabel = formatLookupThickness(inherited);
            if (thicknessLabel) notes.push(`当前正式参考数据里没有找到同时满足${thicknessLabel}和所述热工条件的方案。`);
            notes = [...notes, "选用表未命中不等于知识库没有该方案，请继续检索图集原文"];
          }
          if (inherited.filters?.some((filter) => filter.toleranceAdjusted) && !notes.includes(TOLERANCE_ADJUSTED_NOTE)) {
            notes.push(TOLERANCE_ADJUSTED_NOTE);
          }
          const pageOutcome = await emitReferencePages(ctx, candidates);
          candidates = pageOutcome.candidates;
          const nearbyPages = await emitReferencePages({ app: ctx.app }, nearbyFacts);
          nearbyFacts = nearbyPages.candidates;
          ctx.thermalCanonicalAnswers = setThermalAnswerFacts(ctx, buildAllowedAnswerFacts(inherited, candidates, ctx.userMessage ?? "", lookupDecision?.matchedCount as number | undefined,
            { nearbyCandidates: nearbyFacts }));
          notes = [...notes, ...pageOutcome.warnings];
          {
            const snapshot: LastReferenceLookup = {
              query: { ...inherited, mode: effectiveMode },
              candidates,
              createdAt: new Date().toISOString(),
              matchedSystemHint,
              isFallback
            };
            await persistLastReferenceLookup(ctx, snapshot);
          }
          if (pageOutcome.missingPage && candidates.length > 0) {
            notes = [...notes, REFERENCE_PAGE_MISSING_NOTE];
          }
          // 查询诊断：matched=0 但 nearby>0 时必须能看出具体是哪个条件把候选挡掉了。
          {
            const nearby = (lookupDecision?.nearbyCandidates as Array<{ id: string; constraintMatch: ConstraintMatch }> | undefined) ?? [];
            const debug = buildThermalQueryDebug({
              query: inherited,
              rawText: ctx.userMessage ?? "",
              lifecycle: resolution.lifecycle,
              matchedCount: lookupDecision?.matchedCount as number | undefined,
              returnedCandidateIds: candidates.map(candidate => candidate.id),
              nearby: nearby.map(item => toRejectedCandidateDebug(item.id, item.constraintMatch)),
              toolFilters: inherited.filters,
              stageCounts: lookupDecision?.stageCounts as ThermalQueryDebugSnapshot["stageCounts"] | undefined
            });
            logThermalQueryDebug(ctx.app.log, debug);
          }
          const data = normalizeReferenceLookupForModel({
            canonicalAnswers: ctx.thermalCanonicalAnswers, queryState: inherited,
            allowedFacts: ctx.thermalAllowedFacts,
            thicknessMm: inherited.thicknessMm,
            thicknessMin: inherited.thicknessMin,
            thicknessMax: inherited.thicknessMax,
            preferThinner: inherited.preferThinner,
            filters: inherited.filters,
            requestedTolerance: inherited.requestedTolerance,
            effectiveTolerance: inherited.effectiveTolerance,
            toleranceAdjusted: inherited.toleranceAdjusted,
            metric: inherited.metric,
            targetValue: inherited.targetValue,
            tolerance: effectiveTolerance,
            found: candidates.length > 0,
            candidates,
            notes,
            lookupMode: effectiveMode,
            kTolerance: inherited.metric === "K" ? effectiveTolerance : null,
            matchedSystemHint,
            isFallback
          });
          return toolOk(data, {
            summary: candidates.length > 0
              ? `找到 ${candidates.length} 条接近目标的已发布参考档位`
              : "选用表未命中，需继续检索知识库图集",
            ...(pageOutcome.sources.length > 0 ? { sources: pageOutcome.sources } : {})
          });
        }

        const last = ctx.taskState?.lastReferenceLookup;
        const dictionary = await loadThermalQueryDictionary(ctx.app.db);
        const calculation = normalizeConversationLookupQuery({ ...args, mode: args.lookupMode }, ctx.userMessage ?? "", last, dictionary);
        const single = last?.selectedCandidateIds?.length === 1 ? last.candidates.find(candidate => candidate.id === last.selectedCandidateIds![0]) : last?.candidates.length === 1 ? last.candidates[0] : undefined;
        let query: ThermalQueryState = { ...calculation.query, intent: isThermalComplianceIntent(ctx.userMessage ?? "") ? "COMPLIANCE" as const : "THERMAL" as const };
        const requiresStandardScope = isThermalComplianceIntent(ctx.userMessage ?? "") || !!query.regionCode || !!query.standardLimitId;
        if (requiresStandardScope) {
          const scoped = await resolveScopedThermalStandard(ctx.app.db, query);
          if (!scoped.limit) query = { ...query, unresolved: [...(query.unresolved ?? []).filter(item => item.field !== "standardLimitId"), { field: "standardLimitId", reason: scoped.reason! }] };
          else query.unresolved = query.unresolved?.filter(item => item.field !== "standardLimitId");
        }
        const schemeId = query.schemeId ?? single?.schemeId;
        const productSpecId = query.productSpecId ?? single?.productSpecId;
        const thicknessMm = query.thicknessMm ?? single?.thicknessMm;
        query = traceQueryState({ ...query, schemeId, productSpecId, thicknessMm }, last?.query);
        await persistLastReferenceLookup(ctx, { query, candidates: (last?.candidates ?? []).filter(candidate => validateCandidateAgainstQueryState(candidate, query).passed), createdAt: new Date().toISOString() });
        if (!args.mode || !schemeId || !productSpecId || thicknessMm == null || calculation.needsClarification || query.unresolved?.length) {
          ctx.thermalCanonicalAnswers = [query.unresolved?.length
            ? renderClarification(query, ctx.userMessage ?? "")
            : "这次计算还差构造方案、产品规格或精确厚度，帮我确认一下（已明确的条件都保留）。"];
          return toolOk({ needsClarification: true, queryState: query, instruction: ctx.thermalCanonicalAnswers[0] });
        }
        const scheme = dictionary.selectionFacts.find(item => item.schemeId === schemeId);
        const spec = dictionary.selectionFacts.find(item => item.productSpecId === productSpecId);
        const system = dictionary.selectionFacts.find(item => item.systemId === scheme?.systemId && item.systemName);
        const selectionMatch = validateCandidateAgainstQueryState({ ...system, ...scheme, ...spec, thicknessMm,
          regionCode: requiresStandardScope ? query.regionCode : undefined,
          standardLimitId: requiresStandardScope ? query.standardLimitId : undefined,
          structureType: requiresStandardScope ? query.structureType : undefined,
          setBuildingTypes: requiresStandardScope && query.buildingType ? [query.buildingType] : []
        }, { ...query, filters: [], metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined });
        if (!scheme || !spec || !selectionMatch.passed) {
          ctx.thermalCanonicalAnswers = ["当前方案、产品规格或材料关系无法证明同时满足已明确的条件，请确认计算对象。"];
          return toolOk({ needsClarification: true, constraintMatch: selectionMatch, queryState: query, instruction: ctx.thermalCanonicalAnswers[0] });
        }
        const result = await executeThermalCalc(ctx.app, ctx.request, ctx.user, {
          mode: args.mode, schemeId, productSpecId, thicknessMm,
          regionCode: query.regionCode, standardLimitId: query.standardLimitId, buildingType: query.buildingType, structureType: query.structureType,
          ruleCode: args.ruleCode,
          projectId: ctx.conversation.projectId ?? null
        });
        const record = result.record;
        const presentation = record ? buildThermalCalcPresentation(record) : null;
        let answer = presentation ? buildCalculationAnswer(presentation, /详细|怎么算|计算过程/.test(ctx.userMessage ?? ""), requiresStandardScope) : "本次热工计算未形成可核验结果，请确认方案、规格和厚度。";
        if (record && requiresStandardScope) {
          const standard = record.standard as Record<string, unknown> | null;
          if (standard) answer += `\n标准依据：${standard.basisName ?? standard.basisCode ?? "已确认正式标准"}${standard.clauseRef ? `，${standard.clauseRef}` : ""}。`;
        }
        if (presentation) {
          const calculatedMatch = validateCandidateAgainstQueryState({ ...system, ...scheme, ...spec, thicknessMm,
            productThermalResistance: args.mode === "REFERENCE_TABLE" ? ((record?.result as { candidates?: Array<{ productThermalResistance?: number }> })?.candidates?.[0]?.productThermalResistance) : undefined,
            kValue: presentation.resultK ?? undefined, totalThermalResistance: presentation.totalResistance ?? undefined,
            regionCode: query.regionCode, standardLimitId: query.standardLimitId, structureType: query.structureType,
            setBuildingTypes: query.buildingType ? [query.buildingType] : [] }, query);
          if (!calculatedMatch.passed) answer += "\n该计算结果不能证明满足全部既有筛选条件，请确认是否调整条件。";
          lookupDecision = { query, selectionMatch, calculatedMatch };
        }
        // 计算结果同样冻结成 Allowed Fact Set：K / R₀ / 产品层 R / λ / α / 厚度 / 标准限值 / 合规判定
        // 全部走同一套语义事实校验，回答可以自然表达但不能改数。
        const frozenStandard = record?.standard as Record<string, unknown> | null | undefined;
        setThermalAnswerFacts(ctx, {
          query,
          candidates: [],
          canonicalAnswers: [answer],
          calculation: {
            systemName: system?.systemName,
            schemeId,
            schemeCode: scheme?.schemeCode,
            productSpecId,
            specCode: spec?.specCode,
            thicknessMm,
            sourcePageLabel: (scheme as { sourcePageLabel?: string | null } | undefined)?.sourcePageLabel ?? undefined,
            kValue: presentation?.resultK ?? null,
            totalResistance: presentation?.totalResistance ?? null,
            productThermalResistance: args.mode === "REFERENCE_TABLE"
              ? (record?.result as { candidates?: Array<{ productThermalResistance?: number }> })?.candidates?.[0]?.productThermalResistance
              : undefined,
            standardLimitK: presentation?.limitKValue ?? null,
            complianceAuthorized: requiresStandardScope,
            compliant: presentation?.compliant ?? null,
            standardNames: [frozenStandard?.basisName, frozenStandard?.basisCode].filter((name): name is string => typeof name === "string" && !!name),
            layers: (presentation?.layers ?? []).map(layer => ({ materialName: layer.materialName, thicknessMm: layer.thicknessMm,
              lambda: layer.lambda, correctionFactor: layer.correctionFactor }))
          }
        });
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

export function isReferencePageConsumable(row: {
  versionId: string;
  versionStatus: string;
  documentStatus: string;
  documentDeletedAt: Date | null;
  currentVersionId: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
}, today = new Date().toISOString().slice(0, 10)): boolean {
  return row.versionStatus === "PUBLISHED"
    && row.documentStatus === "ACTIVE"
    && row.documentDeletedAt == null
    && row.currentVersionId === row.versionId
    && (!row.effectiveDate || row.effectiveDate <= today)
    && (!row.expiryDate || row.expiryDate >= today);
}

export async function emitReferencePages(
  ctx: Pick<ToolRuntimeContext, "app" | "onEvent">,
  candidates: ReferenceLookupCandidate[]
) {
  const warnings: string[] = [];
  const pageIds = [...new Set(candidates.map((item) => item.sourcePageId).filter((id): id is string => Boolean(id)))];
  if (pageIds.length === 0) return { missingPage: candidates.length > 0, sources: [] as unknown[], candidates: candidates.map(candidate => ({ ...candidate, optionId: undefined, lambda: undefined, alpha: undefined, layers: undefined })), warnings };
  const rows = await ctx.app.db.select({
    pageId: knowledgePages.id,
    documentId: knowledgePages.documentId,
    documentTitle: knowledgeDocuments.title,
    pageNumber: knowledgePages.pageNumber,
    physicalPageNumber: knowledgePages.physicalPageNumber,
    pageLabel: knowledgePages.pageLabel,
    metadata: knowledgePages.metadata,
    pageImageObjectKey: knowledgePages.pageImageObjectKey,
    versionId: knowledgeDocumentVersions.id,
    versionStatus: knowledgeDocumentVersions.status,
    effectiveDate: knowledgeDocumentVersions.effectiveDate,
    expiryDate: knowledgeDocumentVersions.expiryDate,
    documentStatus: knowledgeDocuments.status,
    documentDeletedAt: knowledgeDocuments.deletedAt,
    currentVersionId: knowledgeDocuments.currentVersionId
  }).from(knowledgePages)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgePages.documentId))
    .innerJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgePages.versionId))
    .where(inArray(knowledgePages.id, pageIds));
  const today = new Date().toISOString().slice(0, 10);
  const validRows = rows.filter((row) => isReferencePageConsumable(row, today));
  candidates = candidates.map((candidate) => {
    const page = validRows.find((row) => row.pageId === candidate.sourcePageId);
    if (!page) return { ...candidate, optionId: undefined, lambda: undefined, alpha: undefined, layers: undefined, sourcePageLabel: null };
    const bound = bindConfirmedPageFacts(candidate, page);
    if (bound.warnings.length) {
      ctx.app.log.warn({ candidateId: candidate.id, pageId: page.pageId, warnings: bound.warnings }, "热工候选来源一致性警告");
      warnings.push(...bound.warnings);
    }
    return bound.candidate;
  });
  const rejectedPageIds = pageIds.filter((pageId) => !validRows.some((row) => row.pageId === pageId));
  if (rejectedPageIds.length > 0) {
    ctx.app.log.warn({ pageIds: rejectedPageIds }, "热工参考页当前不满足正式知识版本访问条件，已跳过签名输出");
  }
  const pages = await Promise.all(validRows.map(async (row) => {
    const physicalPageNumber = row.physicalPageNumber ?? row.pageNumber;
    return {
      pageId: row.pageId,
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      pageNumber: physicalPageNumber,
      physicalPageNumber,
      pageLabel: row.pageLabel,
      pageImageObjectKey: row.pageImageObjectKey,
      metadata: row.metadata,
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
    return { missingPage: false, sources, candidates, warnings };
  }
  return { missingPage: true, sources: [] as unknown[], candidates, warnings };
}

/** 兼容旧导出名 */
export const createThermalCalculateTool = createThermalTool;
